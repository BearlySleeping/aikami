// scripts/src/lib/ops/guards/ratchet_io.ts
//
// Filesystem and git-revision I/O for the ratchet framework. Split out from
// `ratchet.ts` so the policy stays pure and testable, and split out from the
// individual guards so the trusted-base rules are written exactly once.
//
// 🔴 The trusted-base check is a security control, not a convenience. It is
// what stops a branch from raising its own allowance: the baseline at the base
// revision is the authority, and the branch may only shrink relative to it.
// When a base revision is explicitly configured and cannot be read, that is a
// failure (fail closed) — an unreadable authority is not the same as no
// authority.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type RefReadResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'unavailable'; message: string };

/** Parse a JSON file, or return `undefined` when it does not exist. */
export const readJsonFile = (path: string): unknown => {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
};

/** Parse a JSON file, converting any failure into a labelled message. */
export const readJsonFileSafe = (
  path: string,
  label: string,
): { ok: true; value: unknown } | { ok: false; error: string } => {
  if (!existsSync(path)) {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `could not parse ${label}: ${message}` };
  }
};

export const writeTextFile = (path: string, text: string): void => {
  writeFileSync(path, text);
};

/**
 * Reads and parses a JSON file at a git revision.
 *
 * `missing` means the file did not exist at that revision — the legitimate
 * bootstrap case, where there is nothing to compare against. `unavailable`
 * means the check could not be performed at all; callers that were given an
 * explicit base revision MUST treat that as a failure.
 */
export const readJsonAtRef = (options: {
  root: string;
  ref: string;
  /** Repo-relative POSIX path. */
  relPath: string;
}): RefReadResult => {
  const { root, ref, relPath } = options;
  let output: string;
  try {
    output = execFileSync('git', ['show', `${ref}:${relPath}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `git show <ref>:<path>` reports a path that simply is not in that tree
    // with one of these; that is the bootstrap case, not a failure.
    if (
      /exists on disk, but not in|does not exist in|fatal: path .* does not exist/i.test(message)
    ) {
      return { status: 'missing' };
    }
    // Anything else — unknown revision, no git binary, no repository,
    // permission denied — means the authority could not be consulted.
    return { status: 'unavailable', message };
  }

  try {
    return { status: 'ok', value: JSON.parse(output) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unavailable', message: `${ref}:${relPath} is not valid JSON: ${message}` };
  }
};

/**
 * Resolves the base revision to compare against, in precedence order:
 *
 *   1. `--base-ref=<ref>` / `--base-ref <ref>` on the command line;
 *   2. `AIKAMI_GUARD_BASE_REF`;
 *   3. `BASE_REF` (what CI exports), qualified to `origin/<ref>` because moon
 *      diffs against the remote-tracking ref.
 *
 * An empty value is treated as "not configured" rather than as a ref named
 * `''`, which would otherwise be a silent fail-open.
 */
export const resolveBaseRef = (options: {
  args: readonly string[];
  env?: Record<string, string | undefined>;
}): string | undefined => {
  const env = options.env ?? process.env;
  const inline = options.args.find((arg) => arg.startsWith('--base-ref='));
  if (inline) {
    const value = inline.slice('--base-ref='.length).trim();
    return value.length > 0 ? value : undefined;
  }
  const index = options.args.indexOf('--base-ref');
  if (index >= 0) {
    const value = (options.args[index + 1] ?? '').trim();
    return value.length > 0 ? value : undefined;
  }
  const explicit = (env.AIKAMI_GUARD_BASE_REF ?? '').trim();
  if (explicit.length > 0) {
    return explicit;
  }
  const base = (env.BASE_REF ?? '').trim();
  if (base.length === 0) {
    return undefined;
  }
  return base.startsWith('origin/') ? base : `origin/${base}`;
};

/**
 * Repo-relative POSIX path for a file inside the repository root.
 * Returns `undefined` when the path escapes the root (a fixture tree in
 * `$TMPDIR`, for example), which callers treat as "no trusted-base check
 * possible" rather than as an error.
 */
export const relativeToRoot = (root: string, absolutePath: string): string | undefined => {
  const normalizedRoot = root.replace(/\/+$/, '');
  if (!absolutePath.startsWith(`${normalizedRoot}/`)) {
    return undefined;
  }
  return absolutePath
    .slice(normalizedRoot.length + 1)
    .split('\\')
    .join('/');
};
