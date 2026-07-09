// .pi/extensions/swarm_guard.ts
/**
 * Swarm Guard Pi Extension.
 *
 * Deterministic guardrails for swarm worker sessions. Loaded by every pi
 * session in the repo, but scope enforcement only activates when the
 * SWARM_ROLE env var is set (the director injects it per pane).
 *
 * Guards:
 *   1. Route-group path hygiene — SvelteKit route groups use LITERAL parens.
 *      LLMs habitually write `\(dev\)` first, creating a broken empty dir,
 *      then retry with `(dev)`. We fix write/edit/read paths in-place and
 *      block bash commands that would create a literal `\(dev\)` directory.
 *   2. Coder scope enforcement — the coder must never create QA-scope
 *      artifacts (dev sandbox routes, E2E specs, POMs). Blocking at the
 *      tool layer is cheaper and more reliable than prompt rules.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// ── Route-group escape detection ─────────────────────────────

/** Matches backslash-escaped route groups: `\(dev\)`, `\\(sandbox\\)`, etc. */
const ESCAPED_GROUP_RE = /\\+\(([a-z0-9_-]+)\\+\)/gi;

/**
 * Matches an escaped route group INSIDE shell quotes — the hallucination
 * that creates a literal `\(dev\)` directory. Unquoted `\(dev\)` is valid
 * bash (the backslashes are consumed by the shell), so only quoted
 * occurrences are bugs.
 */
const QUOTED_ESCAPED_GROUP_RE = /(['"])[^'"]*\\+\([a-z0-9_-]+\\+\)[^'"]*\1/i;

const fixEscapedGroups = (value: string): string => value.replace(ESCAPED_GROUP_RE, '($1)');

// ── Coder scope (QA-owned paths) ─────────────────────────────

const QA_SCOPE_PATTERNS: readonly RegExp[] = [
  /routes\/\(dev\)\//i, // dev sandbox routes
  /apps\/e2e\//i, // E2E specs + POMs + visual suites
];

const isQaScopePath = (path: string): boolean => {
  const normalized = fixEscapedGroups(path);
  return QA_SCOPE_PATTERNS.some((re) => re.test(normalized));
};

/** Bash verbs that create or modify files. Reads (ls, cat, rg) stay allowed. */
const BASH_WRITE_VERB_RE = /\b(mkdir|touch|tee|cp|mv|rm|sed\s+-i)\b|>{1,2}/;

const CODER_SCOPE_REASON =
  '🔴 BLOCKED — QA scope violation. Dev sandbox pages under routes/(dev)/, ' +
  'E2E specs, POMs, and visual suites are created by the QA agent, not the coder. ' +
  'Implement ONLY the `## Coder scope` section of the architect plan. ' +
  'Skip this file and continue with the remaining coder-scope work.';

const ESCAPED_PATH_REASON =
  '🔴 BLOCKED — backslash-escaped route group inside shell quotes. ' +
  'This creates a literal `\\(dev\\)` directory, breaking the SvelteKit route tree. ' +
  "Route groups use LITERAL parentheses. Correct form: mkdir -p 'src/routes/(dev)/dev/...' " +
  '(quotes handle the parens — no backslashes needed).';

// ── Extension registration ───────────────────────────────────

export default function (pi: ExtensionAPI) {
  const role = process.env.SWARM_ROLE ?? '';

  pi.on('tool_call', async (event) => {
    const input = event.input as Record<string, unknown>;

    // ── Guard 1a: fix escaped route groups in file-path tools ──
    if (
      (event.toolName === 'write' || event.toolName === 'edit' || event.toolName === 'read') &&
      typeof input.path === 'string' &&
      ESCAPED_GROUP_RE.test(input.path)
    ) {
      ESCAPED_GROUP_RE.lastIndex = 0;
      input.path = fixEscapedGroups(input.path);
    }

    // ── Guard 1b: block bash commands that create literal \(dev\) dirs ──
    if (
      event.toolName === 'bash' &&
      typeof input.command === 'string' &&
      QUOTED_ESCAPED_GROUP_RE.test(input.command)
    ) {
      return { block: true, reason: ESCAPED_PATH_REASON };
    }

    // ── Guard 2: coder must not touch QA-scope paths ──
    if (role !== 'coder') {
      return;
    }

    if (
      (event.toolName === 'write' || event.toolName === 'edit') &&
      typeof input.path === 'string' &&
      isQaScopePath(input.path)
    ) {
      return { block: true, reason: CODER_SCOPE_REASON };
    }

    if (event.toolName === 'bash' && typeof input.command === 'string') {
      const cmd = fixEscapedGroups(input.command);
      if (BASH_WRITE_VERB_RE.test(cmd) && QA_SCOPE_PATTERNS.some((re) => re.test(cmd))) {
        return { block: true, reason: CODER_SCOPE_REASON };
      }
    }
  });
}
