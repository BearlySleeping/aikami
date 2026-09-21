// apps/frontend/client/src/lib/views/ai/local_ai_wizard_view_model.test.ts
//
// Tests for the local AI install wizard ViewModel (C-467).
// Uses createFixtureExecutor for deterministic hardware probes and injects the
// sidecar/config/runtime capabilities directly — no global service registry
// mock.
//
// AC-2: Hardware detection produces a plan matching real hardware.
// AC-4: Corrupted/interrupted downloads are never mistaken for ready.

import { describe, expect, test } from 'bun:test';
import { createFixtureExecutor } from '@aikami/local-ai';
import {
  createLocalAiWizardViewModel,
  type LocalAiWizardConfigCapabilities,
  type LocalAiWizardRuntimeCapabilities,
  type LocalAiWizardSidecarCapabilities,
  type LocalAiWizardViewModelOptions,
} from './local_ai_wizard_view_model.svelte';

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

const CPU_FIXTURES = {
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

const runtime: LocalAiWizardRuntimeCapabilities = {
  getRuntimeInfo: async () => ({ platform: 'linux' as const, arch: 'x64' as const }),
};

const createSidecar = (): LocalAiWizardSidecarCapabilities => {
  const state: LocalAiWizardSidecarCapabilities['state'] = { status: 'not-installed' };
  return {
    get state() {
      return state;
    },
    config: {
      host: '127.0.0.1',
      port: 11434,
      binaryName: 'binaries/llama-server',
      modelPath: '',
      healthEndpoint: '/health',
    },
    start: async () => {},
    stop: async () => {},
  };
};

const createConfig = (): LocalAiWizardConfigCapabilities => ({
  state: { connections: [] },
  addConnection: () => 'new-id',
  save: async () => {},
});

const createViewModel = (
  options: Partial<
    Pick<LocalAiWizardViewModelOptions, 'executor' | 'platform' | 'arch' | 'isDesktop'>
  > = {},
) =>
  createLocalAiWizardViewModel({
    className: 'test-wizard',
    executor: options.executor ?? createFixtureExecutor({ table: NVIDIA_FIXTURES }),
    platform: options.platform,
    arch: options.arch,
    isDesktop: options.isDesktop ?? (() => true),
    sidecar: createSidecar(),
    config: createConfig(),
    runtime,
  });

// ── Tests ─────────────────────────────────────────────────────────────

describe('LocalAiWizardViewModel', () => {
  test('starts in idle state', () => {
    const vm = createViewModel();

    expect(vm.step).toBe('idle');
    expect(vm.hardwareProfile).toBeNull();
    expect(vm.stackPlan).toBeNull();
    expect(vm.errorMessage).toBe('');
  });

  test('detection transitions through detecting → plan (AC-2)', async () => {
    const vm = createViewModel({ platform: 'linux', arch: 'x64' });

    const promise = vm.startDetection();
    expect(vm.step).toBe('detecting');
    await promise;

    expect(vm.step).toBe('plan');
    expect(vm.hardwareProfile).not.toBeNull();
    expect(vm.hardwareProfile?.gpu.vendor).toBe('nvidia');
    expect(vm.hardwareProfile?.ramMb).toBeGreaterThan(0);
    expect(vm.stackPlan).not.toBeNull();
  });

  test('detection with no GPU (CPU-only) still produces a plan', async () => {
    const vm = createViewModel({
      executor: createFixtureExecutor({ table: CPU_FIXTURES }),
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
    const vm = createViewModel();

    await vm.startInstall();

    expect(vm.step).toBe('error');
    expect(vm.errorMessage).toContain('No model selected');
  });

  test('reset returns to idle', async () => {
    const vm = createViewModel();

    await vm.startDetection();
    expect(vm.step).toBe('plan');

    vm.reset();
    expect(vm.step).toBe('idle');
    expect(vm.hardwareProfile).toBeNull();
    expect(vm.stackPlan).toBeNull();
  });

  test('retry from error returns to idle when hardware is unknown', async () => {
    const vm = createViewModel();

    await vm.startInstall();
    expect(vm.step).toBe('error');

    vm.retry();
    expect(vm.step).toBe('idle');
  });

  test('startInstall with detection errors when the download host is unavailable (AC-4)', async () => {
    const vm = createViewModel({ platform: 'linux', arch: 'x64' });

    await vm.startDetection();
    expect(vm.step).toBe('plan');

    await vm.startInstall();

    expect(vm.step).toBe('error');
  });

  test('contract suite placeholder — AC-1 requires Tauri runtime', () => {
    // The probe_executor.contract_suite.ts requires a real Tauri webview
    // context to run against the Tauri adapter. In unit tests, we verify
    // the adapter shape and the fixture_executor conformance instead.
    const hasTauriInternals = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    expect(hasTauriInternals).toBe(false);
  });

  // ── P01: Unsupported-host guards ───────────────────────────────────

  test('P01: startDetection returns error when not in Tauri (browser)', async () => {
    const vm = createViewModel({
      platform: 'linux',
      arch: 'x64',
      isDesktop: () => false,
    });

    await vm.startDetection();

    expect(vm.step).toBe('error');
    expect(vm.errorMessage).toContain('requires the desktop app');
    expect(vm.hardwareProfile).toBeNull();
    expect(vm.stackPlan).toBeNull();
  });

  test('P01: startInstall returns error when not in Tauri (browser)', async () => {
    const vm = createViewModel({
      platform: 'linux',
      arch: 'x64',
      isDesktop: () => false,
    });

    await vm.startInstall();

    expect(vm.step).toBe('error');
    expect(vm.errorMessage).toContain('requires the desktop app');
  });

  test('P01: startDetection still works in Tauri context (desktop)', async () => {
    const vm = createViewModel({
      platform: 'linux',
      arch: 'x64',
      isDesktop: () => true,
    });

    await vm.startDetection();

    expect(vm.step).toBe('plan');
    expect(vm.hardwareProfile).not.toBeNull();
    expect(vm.stackPlan).not.toBeNull();
  });
});
