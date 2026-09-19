// scripts/src/lib/ops/__tests__/guard_scan_inputs.test.ts
//
// 🔴 The `guard-scan` file group is the only thing standing between
// `bun run guard` and ~4,300 lines of hasher WARN spam.
//
// The structural guards hash the whole tree with root-anchored `**/*` inputs,
// and moon walks those from disk — it does NOT skip gitignored paths, and
// `hasher.ignorePatterns` does not help because moon decides "is this a file?"
// before that filter is applied. So every generated/vendored tree left in the
// input set hands moon thousands of directories, symlinks-to-directories and
// unix sockets it cannot hash, and it logs a warning for each. A nested
// worktree's node_modules alone accounted for 4,289 of them.
//
// This test is the guard on that, so dropping a negation (or re-inlining a
// bare `'/.pi/**/*'` into one of the two tasks) fails here rather than in
// someone's terminal.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = import.meta.dir ? resolve(import.meta.dir, '../../../../..') : resolve('.');
const TASKS_FILE = join(REPO_ROOT, '.moon/tasks/scripts.yml');

/**
 * Generated, vendored and agent-runtime trees that must never be hashed.
 * Each entry either produced hasher warnings before the group existed or would,
 * given the walk does not honour `.gitignore`.
 */
const REQUIRED_NEGATIONS = [
  // The 4,289-warning one: nested git worktrees under .pi/workspaces/.
  '!/.pi/workspaces/**',
  // pi's isolated install, symlinked into itself (`node_modules/node_modules`).
  '!/.pi/npm/**',
  // A live Chromium profile: SingletonSocket is a socket, not a file, and the
  // profile races the browser process.
  '!/.pi/.chromium-profile/**',
  '!/.pi/generated-skills/**',
  '!/.pi/git/**',
  // Playwright artifacts deleted mid-walk.
  '!/apps/**/test-results/**',
  // Miniflare D1 state; *.sqlite-wal churns and vanishes.
  '!/apps/**/.wrangler/**',
  '!/apps/**/.svelte-kit/**',
  '!/apps/**/node_modules/**',
  '!/packages/**/node_modules/**',
  '!/scripts/**/node_modules/**',
];

/** The source roots the guards actually read. */
const REQUIRED_ROOTS = ['/apps/**/*', '/packages/**/*', '/scripts/**/*', '/.pi/**/*'];

/**
 * Reads the `guard-scan:` block of the tasks file. No YAML parser is a
 * dependency here and none is needed: the group is a flat list of scalars
 * ending at the next column-0 line (`tasks:`).
 */
const readGuardScanPatterns = (source: string): string[] => {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^ {2}guard-scan:\s*$/.test(line));
  expect(start, 'guard-scan file group is missing from .moon/tasks/scripts.yml').toBeGreaterThan(
    -1,
  );
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .map((line) =>
      line
        .trim()
        .replace(/^-\s*/, '')
        .replace(/^'(.*)'$/, '$1'),
    )
    .filter(Boolean);
};

const countOccurrences = (source: string, needle: string): number =>
  source.split(needle).length - 1;

describe('guard-scan file group', () => {
  const source = readFileSync(TASKS_FILE, 'utf8');
  const patterns = readGuardScanPatterns(source);

  it('excludes every generated, vendored and agent-runtime tree', () => {
    for (const negation of REQUIRED_NEGATIONS) {
      expect(patterns, `${negation} must stay in guard-scan`).toContain(negation);
    }
  });

  it('covers the source roots the guards read', () => {
    for (const root of REQUIRED_ROOTS) {
      expect(patterns, `${root} must stay in guard-scan`).toContain(root);
    }
  });

  it('anchors build-output negations to project roots', () => {
    // `!/scripts/**/dist/**` would silently drop TRACKED source —
    // scripts/src/lib/dist/{config,upload_ort}.ts is scanned by
    // guard-source-file-size and must stay in the input set.
    expect(patterns).toContain('!/scripts/dist/**');
    expect(patterns).not.toContain('!/scripts/**/dist/**');
  });

  it('is consumed by whole-tree guards, not re-inlined', () => {
    // One negation list, N tasks. Re-inlining a bare `'/.pi/**/*'` into any task
    // reintroduces the warning flood for that task only, which is exactly the
    // kind of asymmetry a shared group prevents.
    //
    // Which task consumes which group is asserted per-task in
    // `guard_registry.test.ts`; what belongs here is that the broad roots exist
    // exactly once — inside the shared group, nowhere else.
    expect(countOccurrences(source, "- '/.pi/**/*'")).toBe(1);
    expect(countOccurrences(source, "- '/apps/**/*'")).toBe(1);
    expect(countOccurrences(source, "- '/packages/**/*'")).toBe(1);
  });
});
