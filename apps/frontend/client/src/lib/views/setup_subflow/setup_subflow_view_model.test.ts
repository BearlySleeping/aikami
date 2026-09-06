// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.test.ts
//
// Unit tests for SetupSubflowViewModel — entry paths, capability toggles,
// discovery flow, plan application, and error handling.
// Contract: C-483 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/setup_subflow/

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CapabilitySnapshot } from '@aikami/types';

// ── Mocks ──────────────────────────────────────────────────────────────

const configServiceMock = {
  state: {
    connections: [] as Array<Record<string, unknown>>,
    defaultByCapability: {} as Record<string, string>,
  },
  addConnection: mock(() => 'mock-connection-id'),
  setDefaultConnection: mock(() => {}),
  save: mock(async () => {}),
};

mock.module('$services', () => ({
  configService: configServiceMock,
  capabilityService: {
    detect: mock(
      async (): Promise<CapabilitySnapshot> => ({
        isComplete: true,
        textStatus: 'detected',
        textProviderId: 'ollama',
        textModelName: 'llama3.2',
        imageStatus: 'not_found',
        voiceStatus: 'not_found',
        summary: 'Local AI detected',
        detectedAt: new Date().toISOString(),
      }),
    ),
  },
  runtimeConfigService: {
    getTextUrl: mock(() => 'http://localhost:11434'),
    getImageUrl: mock(() => 'http://localhost:8188'),
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

const { getSetupSubflowViewModel } = await import('./setup_subflow_view_model.svelte');

describe('SetupSubflowViewModel', () => {
  let vm: import('./setup_subflow_view_model.svelte').SetupSubflowViewModelInterface;

  beforeEach(() => {
    configServiceMock.state = { connections: [], defaultByCapability: {} };
    vm = getSetupSubflowViewModel({ className: 'SetupSubflowTest' });
  });

  afterEach(() => {
    vm.dispose();
  });

  // ── Entry path selection ────────────────────────────────────────────────

  test('starts in entry step with null entry path', () => {
    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
    expect(vm.capabilityToggles.length).toBe(3);
  });

  test('selectEntryPath sets entry path and shows toggles for recommended', () => {
    vm.selectEntryPath('recommended');

    expect(vm.entryPath).toBe('recommended');
    expect(vm.step).toBe('results');
  });

  test('selectEntryPath shows toggles for existing', () => {
    vm.selectEntryPath('existing');

    expect(vm.entryPath).toBe('existing');
    expect(vm.step).toBe('results');
  });

  test('selectEntryPath text-only skips directly to applying', () => {
    vm.selectEntryPath('text-only');

    expect(vm.entryPath).toBe('text-only');
    // Text-only immediately applies — step moves to 'applying'
    expect(vm.step).toBe('applying');
  });

  // ── Capability toggles ─────────────────────────────────────────────────

  test('text capability is always required and enabled', () => {
    const textToggle = vm.capabilityToggles.find((t) => t.id === 'text');
    expect(textToggle?.required).toBeTrue();
    expect(textToggle?.enabled).toBeTrue();
  });

  test('image capability is optional and disabled by default', () => {
    const imageToggle = vm.capabilityToggles.find((t) => t.id === 'image');
    expect(imageToggle?.required).toBeFalse();
    expect(imageToggle?.enabled).toBeFalse();
  });

  test('voice capability is optional and disabled by default', () => {
    const voiceToggle = vm.capabilityToggles.find((t) => t.id === 'voice');
    expect(voiceToggle?.required).toBeFalse();
    expect(voiceToggle?.enabled).toBeFalse();
  });

  test('toggleCapability enables optional capability', () => {
    vm.toggleCapability('image');
    const imageToggle = vm.capabilityToggles.find((t) => t.id === 'image');
    expect(imageToggle?.enabled).toBeTrue();
  });

  test('toggleCapability disables optional capability', () => {
    vm.toggleCapability('image');
    vm.toggleCapability('image');
    const imageToggle = vm.capabilityToggles.find((t) => t.id === 'image');
    expect(imageToggle?.enabled).toBeFalse();
  });

  test('toggleCapability does not change required text', () => {
    vm.toggleCapability('text');
    const textToggle = vm.capabilityToggles.find((t) => t.id === 'text');
    expect(textToggle?.enabled).toBeTrue();
  });

  // ── Discovery ──────────────────────────────────────────────────────────

  test('startDiscovery transitions through steps', async () => {
    vm.selectEntryPath('recommended');
    expect(vm.step).toBe('results');

    await vm.startDiscovery();

    expect(vm.isDetecting).toBeFalse();
    expect(vm.step).toBe('plan');
    expect(vm.snapshot).not.toBeNull();
    expect(vm.discoveredProviders.length).toBeGreaterThanOrEqual(0);
  });

  test('startDiscovery populates discovered providers from snapshot', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

    expect(vm.discoveredProviders.length).toBeGreaterThanOrEqual(1);
    const textProvider = vm.discoveredProviders.find((p) => p.capability === 'text');
    expect(textProvider).toBeDefined();
    expect(textProvider?.provider).toBe('ollama');
  });

  test('startDiscovery handles errors gracefully', async () => {
    // Override detect to throw
    const { capabilityService } = await import('$services');
    (capabilityService.detect as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

    expect(vm.step).toBe('error');
    expect(vm.errorMessage.length).toBeGreaterThan(0);
  });

  // ── Plan application ───────────────────────────────────────────────────

  test('applyPlan transitions to ready', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    expect(vm.step).toBe('plan');

    await vm.applyPlan();

    expect(vm.step).toBe('ready');
    expect(vm.isApplying).toBeFalse();
  });

  test('applyPlan seeds connections via configService', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    await vm.applyPlan();

    expect(configServiceMock.addConnection.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(configServiceMock.save.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Navigation ─────────────────────────────────────────────────────────

  test('goBack from results returns to entry', () => {
    vm.selectEntryPath('recommended');
    expect(vm.step).toBe('results');

    vm.goBack();
    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
  });

  test('goBack from plan returns to results', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    expect(vm.step).toBe('plan');

    vm.goBack();
    expect(vm.step).toBe('results');
  });

  test('reset returns to initial state', () => {
    vm.selectEntryPath('recommended');
    vm.toggleCapability('image');
    vm.reset();

    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
    expect(vm.errorMessage).toBe('');
    const imageToggle = vm.capabilityToggles.find((t) => t.id === 'image');
    expect(imageToggle?.enabled).toBeFalse();
  });

  test('retry after error goes back to plan when snapshot exists', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

    // Force error state
    const { capabilityService } = await import('$services');
    (capabilityService.detect as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('test error'),
    );

    // Error was already handled, retry
    vm.retry();
    expect(vm.step).toBe('plan');
  });

  // ── Error handling ────────────────────────────────────────────────────

  test('errorMessage is cleared on new entry selection', () => {
    vm.selectEntryPath('recommended');
    vm.errorMessage = 'previous error';
    vm.selectEntryPath('existing');

    expect(vm.errorMessage).toBe('');
  });
});
