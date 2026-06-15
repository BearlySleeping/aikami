// apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts
//
// Unit tests for BootDiagnosticsViewModel (C-130 + C-133):
// - Provider pings (Ollama, ComfyUI, OpenRouter)
// - State transitions (pending → online/offline/unconfigured)
// - canBoot logic (Text-only gate — image/voice do not block)
// - Active provider switching (Ollama ↔ OpenRouter)
// - Polling lifecycle
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/app/boot/boot_diagnostics_view_model.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts

// ── Helpers ────────────────────────────────────────────────────────────────

type MockFetchResponse = Pick<Response, 'ok' | 'status'>;

/** Sets up a mock on globalThis.fetch that intercepts both Ollama and ComfyUI calls. */
const mockGlobalFetch = (ollama: MockFetchResponse | Error, comfy: MockFetchResponse | Error) => {
  const fn = mock(
    async (input: string | URL | Request, _init?: RequestInit): Promise<MockFetchResponse> => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('11434')) {
        if (ollama instanceof Error) {
          throw ollama;
        }
        return ollama;
      }
      if (url.includes('/api/image/object_info')) {
        if (comfy instanceof Error) {
          throw comfy;
        }
        return comfy;
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  );

  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
};

const { getBootDiagnosticsViewModel } = await import('./boot_diagnostics_view_model.svelte.ts');
type Vm = ReturnType<typeof getBootDiagnosticsViewModel>;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BootDiagnosticsViewModel', () => {
  let fetchSpy: ReturnType<typeof mockGlobalFetch>;

  beforeEach(() => {
    fetchSpy = mockGlobalFetch({ ok: true, status: 200 }, { ok: true, status: 200 });
  });

  afterEach(() => {
    fetchSpy.mockClear();
  });

  const createVm = (opts?: {
    ollama?: MockFetchResponse | Error;
    comfy?: MockFetchResponse | Error;
  }): { vm: Vm; onBoot: ReturnType<typeof mock> } => {
    const onBoot = mock(() => {});
    if (opts) {
      fetchSpy = mockGlobalFetch(
        opts.ollama ?? { ok: true, status: 200 },
        opts.comfy ?? { ok: true, status: 200 },
      );
    }
    const vm = getBootDiagnosticsViewModel({
      className: 'BootDiagnosticsViewModel',
      onBootComplete: onBoot,
    });
    return { vm, onBoot };
  };

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

  // ── checkProviders ───────────────────────────────────────────────────

  test('both online on 200 OK', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  test('both offline when fetch throws', async () => {
    const { vm } = createVm({
      ollama: new Error('refused'),
      comfy: new Error('refused'),
    });
    await vm.checkProviders();
    expect(vm.textStatus).toBe('offline');
    expect(vm.imageStatus).toBe('offline');
    expect(vm.canBoot).toBe(false);
  });

  test('offline on non-200', async () => {
    const { vm } = createVm({
      ollama: { ok: false, status: 503 },
      comfy: { ok: false, status: 500 },
    });
    await vm.checkProviders();
    expect(vm.textStatus).toBe('offline');
    expect(vm.imageStatus).toBe('offline');
  });

  // ── C-133: Text-only gate ────────────────────────────────────────────

  test('C-133: canBoot true when text online, image offline', async () => {
    const { vm } = createVm({
      ollama: { ok: true, status: 200 },
      comfy: new Error('refused'),
    });
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('offline');
    expect(vm.canBoot).toBe(true);
  });

  test('C-133: canBoot false when text offline, image online', async () => {
    const { vm } = createVm({
      ollama: new Error('refused'),
      comfy: { ok: true, status: 200 },
    });
    await vm.checkProviders();
    expect(vm.textStatus).toBe('offline');
    expect(vm.imageStatus).toBe('online');
    expect(vm.canBoot).toBe(false);
  });

  test('C-133: canBoot false when both offline', async () => {
    const { vm } = createVm({
      ollama: new Error('refused'),
      comfy: new Error('refused'),
    });
    await vm.checkProviders();
    expect(vm.canBoot).toBe(false);
  });

  // ── C-133: Provider switching ────────────────────────────────────────

  test('C-133: setActiveTextProvider to openrouter → unconfigured', async () => {
    const { vm } = createVm();
    vm.setActiveTextProvider('openrouter');
    await vm.checkProviders();
    expect(vm.activeTextProvider).toBe('openrouter');
    expect(vm.textStatus).toBe('unconfigured');
    expect(vm.canBoot).toBe(false);
  });

  test('C-133: setActiveTextProvider back to ollama → re-checks', async () => {
    const { vm } = createVm();
    vm.setActiveTextProvider('openrouter');
    await vm.checkProviders();
    expect(vm.textStatus).toBe('unconfigured');

    vm.setActiveTextProvider('ollama');
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  test('C-133: setActiveImageProvider to none → disabled', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('online');

    vm.setActiveImageProvider('none');
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('disabled');
    expect(vm.canBoot).toBe(true);
  });

  test('C-133: setActiveImageProvider to cloud → online', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('online');

    vm.setActiveImageProvider('cloud');
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  // ── Transitions ──────────────────────────────────────────────────────

  test('status transitions from offline to online on reconnect', async () => {
    const a = createVm({ ollama: new Error('refused'), comfy: new Error('refused') });
    await a.vm.checkProviders();
    expect(a.vm.textStatus).toBe('offline');
    expect(a.vm.canBoot).toBe(false);

    const b = createVm({ ollama: { ok: true, status: 200 }, comfy: { ok: true, status: 200 } });
    await b.vm.checkProviders();
    expect(b.vm.textStatus).toBe('online');
    expect(b.vm.canBoot).toBe(true);
  });

  // ── initialize ───────────────────────────────────────────────────────

  test('initialize runs first provider check', async () => {
    const { vm } = createVm();
    await vm.initialize();
    expect(fetchSpy).toHaveBeenCalled();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('online');
  });

  // ── initializeCore gate ──────────────────────────────────────────────

  test('initializeCore does nothing when canBoot is false', () => {
    const { vm, onBoot } = createVm({
      ollama: new Error('refused'),
      comfy: new Error('refused'),
    });
    vm.initializeCore();
    expect(onBoot).not.toHaveBeenCalled();
  });

  test('initializeCore fires callback when canBoot is true (text only)', async () => {
    const { vm, onBoot } = createVm({
      ollama: { ok: true, status: 200 },
      comfy: new Error('refused'),
    });
    await vm.checkProviders();
    expect(vm.textStatus).toBe('online');
    expect(vm.imageStatus).toBe('offline');
    expect(vm.canBoot).toBe(true);

    vm.initializeCore();
    expect(onBoot).toHaveBeenCalledTimes(1);
  });

  // ── Ping URLs ────────────────────────────────────────────────────────

  test('checkProviders pings Ollama on port 11434', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    const calls = fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>;
    expect(calls.some(([u]) => typeof u === 'string' && u.includes('11434'))).toBe(true);
  });

  test('checkProviders pings ComfyUI via Vite proxy', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    expect(fetchSpy).toHaveBeenCalled();
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

  // ── C-133: Edge cases ────────────────────────────────────────────────

  test('C-133: canBoot true when image disabled, text online', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    vm.setActiveImageProvider('none');
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('disabled');
    expect(vm.canBoot).toBe(true);
  });

  test('C-133: cloud image is always online', async () => {
    const { vm } = createVm();
    await vm.checkProviders();
    vm.setActiveImageProvider('cloud');
    await vm.checkProviders();
    expect(vm.imageStatus).toBe('online');
    expect(vm.canBoot).toBe(true);
  });

  // ── C-134: saveOpenRouterKey ────────────────────────────────────────

  test('C-134: saveOpenRouterKey clears tempKey and re-checks providers', async () => {
    const { vm } = createVm({
      ollama: { ok: true, status: 200 },
      comfy: { ok: true, status: 200 },
    });

    // Set a mock API key
    vm.tempOpenRouterKey = 'sk-or-v1-test-key-123';

    // saveOpenRouterKey will try to save via aiSettingsService
    // (which fails gracefully in test context), then re-checks
    await vm.saveOpenRouterKey();

    // Key should be cleared after save
    expect(vm.tempOpenRouterKey).toBe('');

    // checkProviders should have been triggered (fetch spy called)
    expect(fetchSpy).toHaveBeenCalled();
  });

  test('C-134: saveOpenRouterKey is no-op with empty key', async () => {
    const { vm } = createVm();

    vm.tempOpenRouterKey = '   ';
    await vm.saveOpenRouterKey();

    // Key should remain unchanged (whitespace-only)
    expect(vm.tempOpenRouterKey).toBe('   ');
  });
});
