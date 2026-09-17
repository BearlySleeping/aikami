// scripts/src/lib/herdr/port_owner.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstanceRecords, recordInstance } from './instance_registry.ts';
import { killPort } from './port_owner.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A registry directory holding one owned record for PID 4242. */
const ownedRecordDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'aikami-port-owner-'));
  directories.push(directory);
  recordInstance({
    dir: directory,
    record: {
      service: 'client',
      scope: 'run',
      runId: 'run-1',
      checkout: '/checkout',
      pid: 4242,
      pidStartTimeMs: 1000,
      port: 5173,
      startedAt: 'now',
    },
  });
  return directory;
};

describe('killPort termination confirmation', () => {
  it('preserves ownership when the verified process remains alive', async () => {
    const directory = ownedRecordDir();
    const signalled: number[] = [];

    await killPort(5173, {
      service: 'client',
      runId: 'run-1',
      checkout: '/checkout',
      registryDir: directory,
      listPids: async () => [4242],
      inspector: { startTimeMs: async () => 1000, cwd: async () => '/checkout' },
      signal: async (pid) => {
        signalled.push(pid);
        return false;
      },
    });

    expect(signalled).toEqual([4242]);
    expect(readInstanceRecords({ dir: directory })).toHaveLength(1);
  });

  it('clears ownership only after confirmed termination', async () => {
    const directory = ownedRecordDir();
    const signalled: number[] = [];

    await killPort(5173, {
      service: 'client',
      runId: 'run-1',
      checkout: '/checkout',
      registryDir: directory,
      listPids: async () => [4242],
      inspector: { startTimeMs: async () => 1000, cwd: async () => '/checkout' },
      signal: async (pid) => {
        signalled.push(pid);
        return true;
      },
    });

    expect(signalled).toEqual([4242]);
    expect(readInstanceRecords({ dir: directory })).toEqual([]);
  });

  // 🔴 The TOCTOU this pins: ownership is verified, the PID is recycled, and the
  // signal must not be sent. The identity is re-proved by the termination
  // primitive immediately before the syscall, so a change aborts without
  // signalling and leaves the record in place (fail safe, never a false
  // "cleaned up").
  it('does not signal a PID whose identity changed after verification', async () => {
    const directory = ownedRecordDir();

    // First read (verification) sees the owned process; the read taken by the
    // termination boundary sees the recycled one.
    let reads = 0;
    const signalled: number[] = [];
    await killPort(5173, {
      service: 'client',
      runId: 'run-1',
      checkout: '/checkout',
      registryDir: directory,
      listPids: async () => [4242],
      inspector: {
        startTimeMs: async () => {
          reads += 1;
          return reads === 1 ? 1000 : 900_000;
        },
        cwd: async () => '/checkout',
      },
      signal: async (pid) => {
        signalled.push(pid);
        return true;
      },
    });

    expect(signalled).toEqual([]);
    expect(readInstanceRecords({ dir: directory })).toHaveLength(1);
  });

  // 🔴 The validation evidence must CROSS the boundary: if `killPort` checked
  // the identity itself and then handed a bare PID to a pid-only primitive,
  // the boundary would perform no read of its own and this count would be 1.
  it('lets the termination boundary re-prove the identity rather than trusting the caller', async () => {
    const directory = ownedRecordDir();
    let reads = 0;

    await killPort(5173, {
      service: 'client',
      runId: 'run-1',
      checkout: '/checkout',
      registryDir: directory,
      listPids: async () => [4242],
      inspector: {
        startTimeMs: async () => {
          reads += 1;
          return 1000;
        },
        cwd: async () => '/checkout',
      },
      signal: async () => true,
    });

    // One read to verify ownership, one read inside the termination boundary.
    expect(reads).toBe(2);
    expect(readInstanceRecords({ dir: directory })).toEqual([]);
  });
});
