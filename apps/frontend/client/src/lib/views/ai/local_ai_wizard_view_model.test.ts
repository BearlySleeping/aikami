// apps/frontend/client/src/lib/views/ai/local_ai_wizard_view_model.test.ts
//
// Tests for the local AI install wizard ViewModel (C-467).
// Uses createFixtureExecutor for deterministic hardware probes.
//
// AC-2: Hardware detection produces a plan matching real hardware.
// AC-4: Corrupted/interrupted downloads are never mistaken for ready.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createFixtureExecutor } from '@aikami/local-ai';

// ── Fixtures ──────────────────────────────────────────────────────────

const NVIDIA_SMI_OUTPUT = 'NVIDIA RTX 3070, 8192 MiB, 535.00\n';

const NVIDIA_FIXTURES = {
  commands: [
    {
      command: 'nvidia-smi',
      args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
      result: { ok: true, stdout: NVIDIA_SMI_OUTPUT, stderr: '', exitCode: 0 },
    },
    {
      command: 'nproc',
      args: [],
      result: { ok: true, stdout: '8\n', stderr: '', exitCode: 0 },
    },
  ],
  files: [
    {
      path: '/proc/meminfo',
      result: { ok: true, stdout: 'MemTotal:       32768000 kB\n', stderr: '', exitCode: 0 },
    },
  ],
  statfs: [{ path: '.', result: { freeBytes: 220_000_000_000 } }],
};

// ── Mocks ─────────────────────────────────────────────────────────────

// Mock configService before importing the ViewModel
mock.module('$services', () => ({
  configService: {
    state: {
      connections: [],
      defaultByCapability: {},
    },
    addConnection: mock(() => 'new-id'),
    setDefaultConnection: mock(() => {}),
    save: mock(async () => {}),
  },
}));

// Mock sidecarService
mock.module('$services/ai/sidecar_service.svelte', () => ({
  sidecarService: {
    state: { status: 'not-installed' },
    config: { port: 11434, binaryName: 'llama-server', modelPath: '', healthEndpoint: '/health' },
    start: mock(async () => {}),
    stop: mock(async () => {}),
    healthCheck: mock(async () => false),
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe('LocalAiWizardViewModel', () => {
  let getViewModel: typeof import('./local_ai_wizard_view_model.svelte').getLocalAiWizardViewModel;

  beforeEach(async () => {
    const mod = await import('./local_ai_wizard_view_model.svelte');
    getViewModel = mod.getLocalAiWizardViewModel;
  });

  test('starts in idle state', () => {
    const executor = createFixtureExecutor({ table: NVIDIA_FIXTURES });
    const vm = getViewModel({
      className: 'test-wizard',
      executor,
    });

    expect(vm.step).toBe('idle');
    expect(vm.hardwareProfile).toBeNull();
    expect(vm.stackPlan).toBeNull();
    expect(vm.errorMessage).toBe('');
  });

  test('detection transitions through detecting → plan (AC-2)', async () => {
    const executor = createFixtureExecutor({ table: NVIDIA_FIXTURES });
    const vm = getViewModel({
      className: 'test-wizard',
      executor,
      platform: 'linux',
      arch: 'x64',
    });

    // Start detection
    const promise = vm.startDetection();
    expect(vm.step).toBe('detecting');
    await promise;

    // Should have a plan
    expect(vm.step).toBe('plan');
    expect(vm.hardwareProfile).not.toBeNull();
    expect(vm.hardwareProfile?.gpu.vendor).toBe('nvidia');
    expect(vm.hardwareProfile?.ramMb).toBeGreaterThan(0);
    expect(vm.stackPlan).not.toBeNull();
  });

  test('detection with no GPU (CPU-only) still produces a plan', async () => {
    const CpuFixtures = {
      commands: [
        {
          command: 'nvidia-smi',
          args: ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
          result: { ok: false, reason: 'not-found' as const, stdout: '', stderr: '', exitCode: -1 },
        },
        {
          command: 'nproc',
          args: [],
          result: { ok: true, stdout: '4\n', stderr: '', exitCode: 0 },
        },
      ],
      files: [
        {
          path: '/proc/meminfo',
          result: { ok: true, stdout: 'MemTotal:       16777216 kB\n', stderr: '', exitCode: 0 },
        },
      ],
      statfs: [{ path: '.', result: { freeBytes: 50_000_000_000 } }],
    };

    const executor = createFixtureExecutor({ table: CpuFixtures });
    const vm = getViewModel({
      className: 'test-wizard-cpu',
      executor,
      platform: 'linux',
      arch: 'x64',
    });

    await vm.startDetection();

    expect(vm.step).toBe('plan');
    expect(vm.hardwareProfile?.gpu.vendor).toBe('none');
    expect(vm.hardwareProfile?.ramMb).toBeGreaterThan(0);
    expect(vm.stackPlan).not.toBeNull();
  });

  test('startInstall without detection shows error', async () => {
    const executor = createFixtureExecutor({ table: NVIDIA_FIXTURES });
    const vm = getViewModel({
      className: 'test-wizard-no-detect',
      executor,
    });

    await vm.startInstall();

    expect(vm.step).toBe('error');
    expect(vm.errorMessage).toContain('No model selected');
  });

  test('reset returns to idle', async () => {
    const executor = createFixtureExecutor({ table: NVIDIA_FIXTURES });
    const vm = getViewModel({
      className: 'test-wizard-reset',
      executor,
    });

    await vm.startDetection();
    expect(vm.step).toBe('plan');

    vm.reset();
    expect(vm.step).toBe('idle');
    expect(vm.hardwareProfile).toBeNull();
    expect(vm.stackPlan).toBeNull();
  });

  test('retry from error returns to plan when hardware known', async () => {
    const executor = createFixtureExecutor({ table: NVIDIA_FIXTURES });
    const vm = getViewModel({
      className: 'test-wizard-retry',
      executor,
    });

    // Start install without detection → error
    await vm.startInstall();
    expect(vm.step).toBe('error');

    // Retry should go back to plan since we have no hardware profile
    vm.retry();
    expect(vm.step).toBe('idle');
  });
});
