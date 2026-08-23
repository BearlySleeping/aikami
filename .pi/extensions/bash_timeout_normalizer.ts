/**
 * Bash Timeout Normalizer — enforces seconds-only convention for Bash tool timeouts,
 * injects non-interactive environment guards, caps runaway timeouts, and makes
 * `find -exec` terminators survive @hypabolic/pi-hypa's command rewriter.
 *
 * Pi's built-in Bash tool interprets `timeout` as SECONDS. However, the model is
 * frequently trained on millisecond-based APIs and may pass values like 120000
 * (intending 120 s) — which the Bash tool interprets as 120,000 seconds (~33 hours).
 *
 * This extension intercepts `tool_call` events for Bash and:
 *   1. Normalises timeout values that are clearly in milliseconds (≥ 1000) down to seconds.
 *   2. Caps timeouts at a safe maximum (default: 600 s = 10 min).
 *   3. Injects CI=true, FORCE_COLOR=1, GIT_TERMINAL_PROMPT=0 into every command so
 *      CLI tools never hang waiting for interactive input (TTY prompts, colour queries, etc.).
 *
 * Heuristic: timeout ≥ 1000 → divide by 1000 (no legitimate bash timeout needs
 * 1000+ seconds / ~17 minutes).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isToolCallEventType } from '@earendil-works/pi-coding-agent';

/** Maximum allowed timeout in seconds (10 minutes). */
const MAX_TIMEOUT_SECONDS = 600;

/** Default timeout in seconds when none is provided. */
const DEFAULT_TIMEOUT_SECONDS = 60;

/** Environment guard prefix injected before every command. */
const ENV_GUARD = 'export CI=true FORCE_COLOR=1 GIT_TERMINAL_PROMPT=0 2>/dev/null; ';

/**
 * Rewrite an UNQUOTED `\;` to `';'`.
 *
 * 🔴 Works around a bug in `@hypabolic/pi-hypa`'s rewriter, which wraps every
 * bash command as `hypa -c "<command>"`. Its splitter treats the `;` in `\;`
 * as a command separator without honouring the backslash escape, and emits a
 * stray `\"` in its place:
 *
 *   in   find . -exec grep -l "x" {} \; 2>/dev/null
 *   out  hypa -c "find . -exec grep -l \"x\" {} \" ; 2>/dev/null
 *                                                ^^^ opening quote never closed
 *
 * bash then rejects the whole command with `unexpected EOF while looking for
 * matching '"'`. Because the mangling is deterministic, the model retries the
 * identical command and storm-breaker kills the session at three failures —
 * observed 2026-08-23, and in 24 of 28,814 stored bash calls across every
 * model (16 of them on the healthy direct DeepSeek, so this is not a model
 * fault). `';'` is exactly equivalent to `\;` in POSIX find, and survives the
 * rewriter untouched.
 *
 * This extension is project-local, and pi loads `cwd/.pi/extensions/` BEFORE
 * package extensions, so this runs before hypa reads the command.
 *
 * Only unquoted occurrences are rewritten: inside quotes `\;` is literal text
 * (e.g. a grep pattern), and hypa handles those correctly already.
 */
export const quoteExecTerminators = (command: string): string => {
  let out = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;

    if (quote) {
      out += ch;
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '\\' && i + 1 < command.length) {
        // Inside double quotes a backslash escapes the next character.
        out += command[++i] as string;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '\\' && command[i + 1] === ';') {
      out += "';'";
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < command.length) {
      // Preserve any other escape pair verbatim.
      out += ch + (command[++i] as string);
      continue;
    }

    out += ch;
  }

  return out;
};

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event) => {
    if (!isToolCallEventType('bash', event)) {
      return;
    }

    const timeout = event.input?.timeout;
    if (timeout !== undefined && timeout !== null) {
      // Already in seconds range — nothing to do
      if (timeout < 1000) {
        // Cap at safe maximum
        if (timeout > MAX_TIMEOUT_SECONDS) {
          event.input.timeout = MAX_TIMEOUT_SECONDS;
        }
      } else {
        // Convert ms → s
        const seconds = Math.max(1, Math.round(timeout / 1000));
        event.input.timeout = Math.min(seconds, MAX_TIMEOUT_SECONDS);
      }
    } else {
      // No timeout provided — set a safe default
      event.input.timeout = DEFAULT_TIMEOUT_SECONDS;
    }

    // Inject non-interactive environment guards at the front of every command.
    // This prevents tools like git, python, node, etc. from hanging on:
    //   - TTY detection (CI=true)
    //   - Colour / progress queries (FORCE_COLOR=1)
    //   - Credential prompts (GIT_TERMINAL_PROMPT=0)
    if (typeof event.input?.command === 'string') {
      const cmd = quoteExecTerminators(event.input.command);
      // Don't double-inject if already present
      event.input.command = cmd.startsWith('export CI=true') ? cmd : ENV_GUARD + cmd;
    }
  });
}
