/**
 * Bash Timeout Normalizer — enforces seconds-only convention for Bash tool timeouts,
 * injects non-interactive environment guards, and caps runaway timeouts.
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
      const cmd = event.input.command;
      // Don't double-inject if already present
      if (!cmd.startsWith('export CI=true')) {
        event.input.command = ENV_GUARD + cmd;
      }
    }
  });
}
