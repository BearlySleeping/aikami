// scripts/src/lib/ops/__tests__/guards_ratchet_io.test.ts
//
// Tests for the ratchet I/O helpers, with a focus on the trusted-root
// containment check.
//
// 🔴 `relativeToRoot` decides whether a custom `AIKAMI_GUARD_BASELINE` lives
// inside the repository. Getting it wrong in the permissive direction would let
// a path outside the repo be treated as a git-relative baseline path; getting it
// wrong in the restrictive direction silently falls back to the default
// baseline — i.e. the guard stops checking the baseline the operator asked it
// to check, and reports success.
//
// The old implementation was a string-prefix test, which is wrong on Windows
// (mixed separators) and around sibling directories whose names merely start
// with the root. Both are covered here through the injected path flavour, so
// neither needs a Windows runner to be caught.

import { describe, expect, test } from 'bun:test';
import * as nodePath from 'node:path';
import { relativeToRoot, resolveBaseRef } from '../guards/ratchet_io.ts';

const posix = nodePath.posix;
const win32 = nodePath.win32;

describe('relativeToRoot — POSIX', () => {
  test('returns the repo-relative path for a file inside the root', () => {
    expect(relativeToRoot('/repo', '/repo/scripts/baseline.json', posix)).toBe(
      'scripts/baseline.json',
    );
  });

  test('accepts the root with a trailing separator', () => {
    expect(relativeToRoot('/repo/', '/repo/a.ts', posix)).toBe('a.ts');
  });

  test('rejects a sibling directory whose name starts with the root', () => {
    // The string-prefix bug: `/repo-other/a.ts`.startsWith('/repo/') is false,
    // but a naive `startsWith('/repo')` would accept it.
    expect(relativeToRoot('/repo', '/repo-other/a.ts', posix)).toBeUndefined();
  });

  test('rejects a path outside the root', () => {
    expect(relativeToRoot('/repo', '/tmp/baseline.json', posix)).toBeUndefined();
    expect(relativeToRoot('/repo', '/repo/../outside.json', posix)).toBeUndefined();
  });

  test('rejects the root itself (a directory is not a file path)', () => {
    expect(relativeToRoot('/repo', '/repo', posix)).toBeUndefined();
  });
});

describe('relativeToRoot — Windows', () => {
  test('returns a POSIX-separated repo-relative path', () => {
    // 🔴 The bug this covers: a valid in-repo `AIKAMI_GUARD_BASELINE` spelled
    // with backslashes used to fail a `startsWith(root + '/')` test, and the
    // guard silently fell back to the default baseline.
    expect(relativeToRoot('C:\\repo', 'C:\\repo\\scripts\\baseline.json', win32)).toBe(
      'scripts/baseline.json',
    );
  });

  test('accepts a forward-slash spelling of the same path', () => {
    expect(relativeToRoot('C:\\repo', 'C:/repo/scripts/baseline.json', win32)).toBe(
      'scripts/baseline.json',
    );
  });

  test('is case-insensitive on the root, as the filesystem is', () => {
    expect(relativeToRoot('C:\\Repo', 'c:\\repo\\a.ts', win32)).toBe('a.ts');
  });

  test('rejects a sibling directory', () => {
    expect(relativeToRoot('C:\\repo', 'C:\\repo-other\\a.ts', win32)).toBeUndefined();
  });

  test('rejects a different drive', () => {
    expect(relativeToRoot('C:\\repo', 'D:\\repo\\a.ts', win32)).toBeUndefined();
  });
});

describe('resolveBaseRef', () => {
  test('prefers the inline argument', () => {
    expect(resolveBaseRef({ args: ['--base-ref=origin/main'], env: { BASE_REF: 'other' } })).toBe(
      'origin/main',
    );
  });

  test('accepts the separated form', () => {
    expect(resolveBaseRef({ args: ['--base-ref', 'HEAD~1'], env: {} })).toBe('HEAD~1');
  });

  test('falls back to AIKAMI_GUARD_BASE_REF, then BASE_REF', () => {
    expect(resolveBaseRef({ args: [], env: { AIKAMI_GUARD_BASE_REF: 'origin/dev' } })).toBe(
      'origin/dev',
    );
    expect(resolveBaseRef({ args: [], env: { BASE_REF: 'main' } })).toBe('origin/main');
  });

  test('qualifies a bare BASE_REF to origin/<ref>', () => {
    expect(resolveBaseRef({ args: [], env: { BASE_REF: 'release/1' } })).toBe('origin/release/1');
  });

  test('leaves an already-qualified ref alone', () => {
    expect(resolveBaseRef({ args: [], env: { BASE_REF: 'origin/main' } })).toBe('origin/main');
  });

  test('treats an empty value as NOT configured rather than as a ref named ""', () => {
    // 🔴 An empty string must not become a silent fail-open: `git show ''` would
    // error and a naive caller might read that as "no trusted base configured".
    expect(resolveBaseRef({ args: [], env: { AIKAMI_GUARD_BASE_REF: '', BASE_REF: '' } })).toBe(
      undefined,
    );
    expect(resolveBaseRef({ args: ['--base-ref='], env: {} })).toBeUndefined();
  });
});
