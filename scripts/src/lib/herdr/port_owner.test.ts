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

describe('killPort termination confirmation', () => {
  it('preserves ownership when the verified process remains alive', async () => {
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

    await killPort(5173, {
      service: 'client',
      runId: 'run-1',
      checkout: '/checkout',
      registryDir: directory,
      listPids: async () => [4242],
      inspector: { startTimeMs: async () => 1000, cwd: async () => '/checkout' },
      terminate: async () => false,
    });

    expect(readInstanceRecords({ dir: directory })).toHaveLength(1);
  });

  it('clears ownership only after confirmed termination', async () => {
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

    await killPort(5173, {
      service: 'client',
      runId: 'run-1',
      checkout: '/checkout',
      registryDir: directory,
      listPids: async () => [4242],
      inspector: { startTimeMs: async () => 1000, cwd: async () => '/checkout' },
      terminate: async () => true,
    });

    expect(readInstanceRecords({ dir: directory })).toEqual([]);
  });

  // 🔴 The TOCTOU this pins: ownership is verified, the PID is recycled, and
  // `killPid` would then signal a stranger. The identity is re-proved
  // immediately before the signal, so a change aborts without signalling and
  // leaves the record in place (fail safe, never a false "cleaned up").
  it('does not signal a PID whose identity changed after verification', async () => {
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

    // First read (verification) sees the owned process; every later read sees
    // the recycled one.
    let reads = 0;
    let terminations = 0;
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
      terminate: async () => {
        terminations += 1;
        return true;
      },
    });

    expect(terminations).toBe(0);
    expect(readInstanceRecords({ dir: directory })).toHaveLength(1);
  });
});
