/**
 * apps/backend/local-stack/stack/detect.test.ts
 *
 * C-391 detection ACs exercised at the local-stack level (evidence files
 * named in the contract matrix): AC-1 empty PATH, AC-2 stubbed nvidia-smi,
 * AC-12 stubbed docker info. Detection itself lives in @aikami/local-ai;
 * these tests drive it with fixture-replay executors through the CLI
 * adapter path.
 */

import { describe, expect, test } from 'bun:test';
import type { ProbeResult } from '@aikami/local-ai';
import {
  createFixtureExecutor,
  detectHardware,
  runProbeExecutorContractSuite,
} from '@aikami/local-ai';
import { probeExecutor } from './probe_executor.ts';

const ok = (stdout: string): ProbeResult => ({ ok: true, stdout, stderr: '', exitCode: 0 });

describe('AC-1 — detection degrades to CPU without error (empty PATH)', () => {
  test('no GPU tooling → gpu.vendor none, containerRuntime none', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       33554432 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.vendor).toBe('none');
    expect(profile.gpuPassthroughReady).toBe(false);
    expect(profile.containerRuntime).toBe('none');
  });
});

describe('AC-2 — stubbed nvidia-smi', () => {
  test('CUDA 12 driver → nvidia, cudaMajor 12', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok('NVIDIA GeForce RTX 4070, 12282 MiB, 535.104.05\n'),
          },
        ],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.gpu.vramMb).toBe(12282);
    expect(profile.gpu.cudaMajor).toBe(12);
  });

  test('CUDA 13 driver → cudaMajor 13', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok('NVIDIA GeForce RTX 5070, 12282 MiB, 580.00\n'),
          },
        ],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.cudaMajor).toBe(13);
  });
});

describe('AC-12 — stubbed docker info (toolkit absent)', () => {
  test('docker info without nvidia runtime → gpuPassthroughReady false', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [
          {
            command: 'nvidia-smi',
            args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
            result: ok('NVIDIA GeForce RTX 4070, 12282 MiB, 535.104.05\n'),
          },
          { command: 'docker', args: ['info'], result: ok('Runtimes: runc\n') },
        ],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.gpuPassthroughReady).toBe(false);
  });
});

describe('AC-0c — shared contract suite against the Bun/CLI adapter', () => {
  runProbeExecutorContractSuite({
    label: 'bun/cli',
    factory: () => probeExecutor,
    // /proc/1/mem is the only universally-denied read on Linux; on other
    // platforms the adapter has no deterministic denial and the test is
    // skipped (capability-gated in the suite).
    permissionDeniedPath: process.platform === 'linux' ? '/proc/1/mem' : undefined,
  });
});
