// packages/shared/local-ai/src/lib/fixture_executor.test.ts
//
// AC-0b: the full detection + recommendation pipeline runs against the
// fixture-replay executor with ZERO process spawns and produces the same
// StackPlan the Bun/CLI adapter would for equivalent inputs. This proves the
// core is host-agnostic — a Tauri adapter needs no change to @aikami/local-ai.
//
// AC-0c: the shared ProbeExecutor contract suite runs against the fixture
// adapter too.

import { describe, expect, test } from 'bun:test';
import type { ModelManifest } from '@aikami/types';
import { detectHardware } from './detect.ts';
import { createFixtureExecutor } from './fixture_executor.ts';
import { runProbeExecutorContractSuite } from './probe_executor.contract_suite.ts';
import { recommend } from './recommend.ts';

const ok = (stdout: string) => ({ ok: true as const, stdout, stderr: '', exitCode: 0 });

const MANIFEST: ModelManifest = {
  schemaVersion: 1,
  entries: [
    {
      id: 'text-qwen2.5-7b-instruct-q4km',
      modality: 'text',
      tier: '8gb',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'r',
      revision: 'rev',
      file: 'm.gguf',
      targetPath: 'text/m.gguf',
      bytes: 4_683_074_240,
      sha256: 'b',
    },
  ],
};

/** A captured Linux NVIDIA laptop session, replayed with zero spawns. */
const NVIDIA_FIXTURES = createFixtureExecutor({
  table: {
    commands: [
      {
        command: 'nvidia-smi',
        args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
        result: ok('NVIDIA GeForce RTX 3060, 12282 MiB, 535.104.05\n'),
      },
      { command: 'docker', args: ['info'], result: ok('Runtimes: nvidia runc\n') },
    ],
    files: [{ path: '/proc/meminfo', result: ok('MemTotal:       67108864 kB\n') }],
    statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
  },
  unmatched: { ok: false, reason: 'not-found' },
});

describe('AC-0b — fixture pipeline produces the same plan', () => {
  test('detect → recommend against fixtures, no spawns', async () => {
    const profile = await detectHardware({
      executor: NVIDIA_FIXTURES,
      platform: 'linux',
      arch: 'x64',
    });
    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.gpu.vramMb).toBe(12282);
    expect(profile.gpu.cudaMajor).toBe(12);

    const plan = recommend({
      profile,
      modalities: ['text'],
      manifest: MANIFEST,
    });
    // The fixture executor carries the same values the Bun adapter would
    // return for the same commands, so the plan is the Bun adapter's plan.
    expect(plan.backend).toBe('cuda');
    expect(plan.models[0]?.manifestId).toBe('text-qwen2.5-7b-instruct-q4km');
  });

  test('all probes not-found → still a valid CPU plan (AC-1 offline mode)', async () => {
    const executor = createFixtureExecutor({
      table: {
        commands: [],
        files: [{ path: '/proc/meminfo', result: ok('MemTotal:       16777216 kB\n') }],
        statfs: [{ path: '.', result: { freeBytes: 1 << 40 } }],
      },
      unmatched: { ok: false, reason: 'not-found' },
    });
    const profile = await detectHardware({ executor, platform: 'linux', arch: 'x64' });
    expect(profile.gpu.vendor).toBe('none');
    const plan = recommend({ profile, modalities: ['text'], manifest: MANIFEST });
    expect(plan.backend).toBe('cpu');
    expect(plan.models.length).toBe(1);
  });
});

describe('AC-0c — shared contract suite against the fixture adapter', () => {
  runProbeExecutorContractSuite({
    label: 'fixture-replay',
    factory: () =>
      createFixtureExecutor({
        table: {
          commands: [
            {
              command: 'definitely-not-a-real-binary-xyz',
              args: [],
              result: { ok: false, reason: 'not-found' },
            },
            {
              command: 'sh',
              args: ['-c', 'echo boom >&2; exit 3'],
              result: { ok: false, reason: 'failed', detail: 'boom' },
            },
            {
              command: 'sh',
              args: ['-c', 'sleep 5'],
              result: { ok: false, reason: 'timeout', detail: 'killed' },
            },
            {
              command: 'printf',
              args: ['%s', '  RTX 4090, 24564 MiB, 570.00  \nSecond line  \n'],
              result: ok('  RTX 4090, 24564 MiB, 570.00  \nSecond line  \n'),
            },
          ],
          files: [
            { path: '/fixture/untouched.txt', result: ok('content\n') },
            { path: '/proc/1/mem', result: { ok: false, reason: 'denied' } },
          ],
          statfs: [{ path: '/fixture', result: { freeBytes: 123 } }],
        },
      }),
    canSpawn: false,
  });
});
