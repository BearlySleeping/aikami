// .pi/extensions/route_guard.ts
/**
 * Route Guard Pi Extension.
 *
 * Deterministic path hygiene for SvelteKit route groups. LLMs habitually
 * write `\(dev\)` first, creating a broken literal `\(dev\)` directory,
 * then retry with `(dev)`. Two guards:
 *
 *   1. write/edit/read paths — escaped groups are fixed in-place silently.
 *   2. bash commands — blocked only when a WRITE verb would create a
 *      literal `\(dev\)` path inside shell quotes. Read-only commands
 *      (ls, find, grep) are allowed so cleanup/inspection still works.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Matches backslash-escaped route groups: `\(dev\)`, `\\(sandbox\\)`, etc. */
const ESCAPED_GROUP_RE = /\\+\(([a-z0-9_-]+)\\+\)/gi;

/**
 * Matches an escaped route group INSIDE shell quotes — the hallucination
 * that creates a literal `\(dev\)` directory. Unquoted `\(dev\)` is valid
 * bash (the backslashes are consumed by the shell), so only quoted
 * occurrences are bugs.
 */
const QUOTED_ESCAPED_GROUP_RE = /(['"])[^'"]*\\+\([a-z0-9_-]+\\+\)[^'"]*\1/i;

/** Bash verbs that create or modify files. Reads (ls, cat, rg, find) stay allowed. */
const BASH_WRITE_VERB_RE = /\b(mkdir|touch|tee|cp|mv|sed\s+-i)\b|>{1,2}/;

const fixEscapedGroups = (value: string): string => value.replace(ESCAPED_GROUP_RE, '($1)');

const ESCAPED_PATH_REASON =
  '🔴 BLOCKED — backslash-escaped route group inside shell quotes. ' +
  'This creates a literal `\\(dev\\)` directory, breaking the SvelteKit route tree. ' +
  "Route groups use LITERAL parentheses. Correct form: mkdir -p 'src/routes/(dev)/dev/...' " +
  '(quotes handle the parens — no backslashes needed).';

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event) => {
    const input = event.input as Record<string, unknown>;

    // ── Guard 1: fix escaped route groups in file-path tools ──
    if (
      (event.toolName === 'write' || event.toolName === 'edit' || event.toolName === 'read') &&
      typeof input.path === 'string' &&
      ESCAPED_GROUP_RE.test(input.path)
    ) {
      ESCAPED_GROUP_RE.lastIndex = 0;
      input.path = fixEscapedGroups(input.path);
    }

    // ── Guard 2: block bash WRITE commands targeting literal \(dev\) dirs ──
    if (
      event.toolName === 'bash' &&
      typeof input.command === 'string' &&
      QUOTED_ESCAPED_GROUP_RE.test(input.command) &&
      BASH_WRITE_VERB_RE.test(input.command)
    ) {
      return { block: true, reason: ESCAPED_PATH_REASON };
    }
  });
}
