// apps/backend/local-stack/stack/generation/flock.test.ts
//
// C-519/C-522: the in-tree flock port must behave like `@bearly/flock` — one
// exclusive holder, kernel-released on descriptor close, diagnostics persisted
// only while held. The cross-process case is the one the in-process identity
// guard cannot fake, so it runs a real child process.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isFlockHeld, tryAcquireFlock } from './flock.ts';

const lockRoots: string[] = [];

/** A fresh lock path under a private temp root (parent dir created by the lock). */
const newLockPath = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-flock-'));
  lockRoots.push(root);
  return join(root, 'nested', 'run.lock');
};

/** Runs a separate process that reports whether it could take the same lock. */
const probeChild = (lockPath: string): string => {
  const moduleUrl = new URL('./flock.ts', import.meta.url).href;
  const script = `const { tryAcquireFlock } = await import(${JSON.stringify(moduleUrl)});
const handle = tryAcquireFlock(${JSON.stringify(lockPath)});
process.stdout.write(handle === undefined ? 'blocked' : 'acquired');`;
  const child = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return child.stdout.toString();
};

afterEach(() => {
  for (const root of lockRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('flock', () => {
  test('persists the diagnostics body only while the lock is held', () => {
    const path = newLockPath();
    const handle = tryAcquireFlock(path, { body: 'owner=1' });
    expect(handle).toBeDefined();
    expect(readFileSync(path, 'utf8')).toBe('owner=1');
    handle?.release();
  });

  test('refuses a second holder in-process and frees the path on release', () => {
    const path = newLockPath();
    const first = tryAcquireFlock(path);
    expect(first).toBeDefined();
    expect(tryAcquireFlock(path)).toBeUndefined();
    first?.release();
    const second = tryAcquireFlock(path);
    expect(second).toBeDefined();
    second?.release();
  });

  test('reports liveness while held, and not after release', () => {
    const path = newLockPath();
    const handle = tryAcquireFlock(path);
    expect(isFlockHeld(path)).toBe(true);
    handle?.release();
    expect(isFlockHeld(path)).toBe(false);
  });

  test('excludes a second process until the holder releases', () => {
    const path = newLockPath();
    const handle = tryAcquireFlock(path);
    expect(probeChild(path)).toBe('blocked');
    handle?.release();
    expect(probeChild(path)).toBe('acquired');
  });
});
