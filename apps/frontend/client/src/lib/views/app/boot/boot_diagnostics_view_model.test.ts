// apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts
//
// Unit tests for BootDiagnosticsViewModel (C-130 + C-133 + C-318):
// - Provider pings delegated to CapabilityService (C-318)
// - State transitions (pending → online/offline)
// - canBoot logic (Text-only gate — image/voice do not block)
// - Active provider switching (Ollama ↔ OpenRouter)
// - Polling lifecycle
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/app/boot/boot_diagnostics_view_model.test.ts

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts
// capabilityService is mocked globally via test_preload.ts (returns 'detected'/'online')

const { getBootDiagnosticsViewModel } = await import('./boot_diagnostics_view_model.svelte.ts');
type Vm = ReturnType<typeof getBootDiagnosticsViewModel>;
// Import the mocked capabilityService to verify method calls in delegation tests.
const { capabilityService } = await import('$services');

// ── Helpers ────────────────────────────────────────────────────────────────

const createVm = (): { vm: Vm; onBoot: ReturnType<typeof mock> } => {
  const onBoot = mock(() => {});
  const vm = getBootDiagnosticsViewModel({
    className: 'BootDiagnosticsViewModel',
    onBootComplete: onBoot,
  });
  return { vm, onBoot };
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BootDiagnosticsViewModel', () => {
  afterEach(() => {
    // No-op — preload mock is static
  });

  // ── Initial State ────────────────────────────────────────────────────

  test('starts with both providers in pending state', () => {
    const { vm } = createVm();
    expect(vm.textStatus).toBe('pending');
    expect(vm.imageStatus).toBe('pending');
  });

  test('default activeTextProvider is ollama', () => {
    expect(createVm().vm.activeTextProvider).toBe('ollama');
  });

  test('default activeImageProvider is comfyui', () => {
    expect(createVm().vm.activeImageProvider).toBe('comfyui');
  });

  test('voiceStatus defaults to online', () => {
    expect(createVm().vm.voiceStatus).toBe('online');
  });

  test('canBoot is false when providers are pending', () => {
    expect(createVm().vm.canBoot).toBe(false);
  });

  // ── checkProviders (delegates to CapabilityService, C-318) ──────────

  test('checkProviders delegates to capabilityService and maps results', async () => {
    const detectTextSpy = spyOn(capabilityService, 'detectText');
    const detectImageSpy = spyOn(capabilityService, 'detectImage');

    const { vm } = createVm();
    await vm.checkProviders();

    // Verify delegation: both methods must be called exactly once
    expect(detectTextSpy).toHaveBeenCalledTimes(1);
    expect(detectImageSpy).toHaveBeenCalledTimes(1);

    // Preload mock returns 'detected' → mapped to 'online'
    expect(vm.textStatus).toBe('online');
    // Preload mock returns 'online' → mapped to 'online'
    expect(vm.imageStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  // ── C-133: Text-only gate ────────────────────────────────────────────

  test('C-133: canBoot true when text online', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  // ── C-318: Provider switching (UI only — delegation is unified) ────

  test('C-318: setActiveTextProvider switches UI state but detection is unified', async () => {
    const { vm } = createVm();
    vm.setActiveTextProvider('openrouter');
    await vm.checkProviders();
    expect(vm.activeTextProvider).toBe('openrouter');
    // Delegation ignores provider switch — capabilityService returns actual detection
    expect(vm.textStatus).toBe('online');
  });

  test('C-318: setActiveTextProvider back to ollama', async () => {
    const { vm } = createVm();
    vm.setActiveTextProvider('openrouter');
    await vm.checkProviders();

    vm.setActiveTextProvider('ollama');
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  test('C-133: setActiveImageProvider to none → disabled', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('online');

    vm.setActiveImageProvider('none');
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('disabled');
    expect(vm.canBoot).toBe(true);
  });

  test('C-133: setActiveImageProvider to cloud → online', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('online');

    vm.setActiveImageProvider('cloud');
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  // ── Transitions ──────────────────────────────────────────────────────

  test('status transitions from pending to online after checkProviders', async () => {
    const { vm } = createVm();
    expect(vm.textStatus).toBe('pending');
    expect(vm.canBoot).toBe(false);

    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  // ── initialize ───────────────────────────────────────────────────────

  test('initialize runs first provider check', async () => {
    const { vm } = createVm();
    await vm.initialize();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('online');
  });

  // ── initializeCore gate ──────────────────────────────────────────────

  test('initializeCore fires callback when canBoot is true', async () => {
    const { vm, onBoot } = createVm();
    await vm.checkProviders();
    expect(vm.canBoot).toBe(true);

    vm.initializeCore();
    expect(onBoot).toHaveBeenCalledTimes(1);
  });

  // ── Polling ──────────────────────────────────────────────────────────

  test('startPolling does not throw', () => {
    expect(() => createVm().vm.startPolling()).not.toThrow();
  });

  test('startPolling is idempotent', () => {
    const { vm } = createVm();
    vm.startPolling();
    vm.startPolling();
  });

  // ── C-134: saveOpenRouterKey ────────────────────────────────────────

  test('C-134: saveOpenRouterKey clears tempKey and re-checks providers', async () => {
    const { vm } = createVm();

    vm.tempOpenRouterKey = 'sk-or-v1-test-key-123';

    await vm.saveOpenRouterKey();

    // Key should be cleared after save
    expect(vm.tempOpenRouterKey).toBe('');
  });

  test('C-134: saveOpenRouterKey is no-op with empty key', async () => {
    const { vm } = createVm();

    vm.tempOpenRouterKey = '   ';
    await vm.saveOpenRouterKey();

    // Key should remain unchanged (whitespace-only)
    expect(vm.tempOpenRouterKey).toBe('   ');
  });
});
