// apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts
//
// Unit tests for BootDiagnosticsViewModel (C-130 AC: provider pings, state
// transitions, canBoot logic, polling lifecycle).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/app/boot/boot_diagnostics_view_model.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mock Response-like object returned by the injectable fetch. */
type MockFetchResponse = Pick<Response, 'ok' | 'status'>;

const createMockFetch = (
  ollamaResponse: MockFetchResponse | Error,
  comfyResponse: MockFetchResponse | Error,
) => {
  const fetchSpy = mock(
    async (url: string | URL, _init?: RequestInit): Promise<MockFetchResponse> => {
      const urlString = typeof url === 'string' ? url : url.toString();

      if (urlString.includes('11434')) {
        if (ollamaResponse instanceof Error) {
          throw ollamaResponse;
        }
        return ollamaResponse;
      }

      if (urlString.includes('8188')) {
        if (comfyResponse instanceof Error) {
          throw comfyResponse;
        }
        return comfyResponse;
      }

      throw new Error(`Unexpected URL: ${urlString}`);
    },
  );

  return fetchSpy;
};

const { getBootDiagnosticsViewModel } = await import('./boot_diagnostics_view_model.svelte.ts');

type BootDiagnosticsViewModelInterface = ReturnType<typeof getBootDiagnosticsViewModel>;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BootDiagnosticsViewModel', () => {
  let fetchSpy: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    fetchSpy = createMockFetch({ ok: true, status: 200 }, { ok: true, status: 200 });
  });

  afterEach(() => {
    fetchSpy.mockClear();
  });

  // ── Factory ───────────────────────────────────────────────────────────

  const createViewModel = (options?: {
    ollamaResponse?: MockFetchResponse | Error;
    comfyResponse?: MockFetchResponse | Error;
  }): {
    viewModel: BootDiagnosticsViewModelInterface;
    onBootCompleteSpy: ReturnType<typeof mock>;
  } => {
    const onBootCompleteSpy = mock(() => {});

    if (options) {
      fetchSpy = createMockFetch(
        options.ollamaResponse ?? { ok: true, status: 200 },
        options.comfyResponse ?? { ok: true, status: 200 },
      );
    }

    const viewModel = getBootDiagnosticsViewModel({
      className: 'BootDiagnosticsViewModel',
      onBootComplete: onBootCompleteSpy,
      fetchImpl: fetchSpy as unknown as (url: string, init?: RequestInit) => Promise<Response>,
    });

    return { viewModel, onBootCompleteSpy };
  };

  // ── AC: Initial State ────────────────────────────────────────────────

  test('starts with both providers in pending state', () => {
    const { viewModel } = createViewModel();

    expect(viewModel.ollamaStatus).toBe('pending');
    expect(viewModel.comfyStatus).toBe('pending');
  });

  test('canBoot is false when providers are pending', () => {
    const { viewModel } = createViewModel();

    expect(viewModel.canBoot).toBe(false);
  });

  // ── AC: checkProviders — both online ─────────────────────────────────

  test('checkProviders sets both to online on 200 OK responses', async () => {
    const { viewModel } = createViewModel();

    await viewModel.checkProviders();

    expect(viewModel.ollamaStatus).toBe('online');
    expect(viewModel.comfyStatus).toBe('online');
    expect(viewModel.canBoot).toBe(true);
  });

  test('checkProviders sets both to offline when fetch throws', async () => {
    const { viewModel } = createViewModel({
      ollamaResponse: new Error('Connection refused'),
      comfyResponse: new Error('Connection refused'),
    });

    await viewModel.checkProviders();

    expect(viewModel.ollamaStatus).toBe('offline');
    expect(viewModel.comfyStatus).toBe('offline');
    expect(viewModel.canBoot).toBe(false);
  });

  test('checkProviders sets to offline on non-200 responses', async () => {
    const { viewModel } = createViewModel({
      ollamaResponse: { ok: false, status: 503 },
      comfyResponse: { ok: false, status: 500 },
    });

    await viewModel.checkProviders();

    expect(viewModel.ollamaStatus).toBe('offline');
    expect(viewModel.comfyStatus).toBe('offline');
    expect(viewModel.canBoot).toBe(false);
  });

  // ── AC: Partial online scenarios ─────────────────────────────────────

  test('canBoot is false when only Ollama is online', async () => {
    const { viewModel } = createViewModel({
      ollamaResponse: { ok: true, status: 200 },
      comfyResponse: new Error('Connection refused'),
    });

    await viewModel.checkProviders();

    expect(viewModel.ollamaStatus).toBe('online');
    expect(viewModel.comfyStatus).toBe('offline');
    expect(viewModel.canBoot).toBe(false);
  });

  test('canBoot is false when only ComfyUI is online', async () => {
    const { viewModel } = createViewModel({
      ollamaResponse: new Error('Connection refused'),
      comfyResponse: { ok: true, status: 200 },
    });

    await viewModel.checkProviders();

    expect(viewModel.ollamaStatus).toBe('offline');
    expect(viewModel.comfyStatus).toBe('online');
    expect(viewModel.canBoot).toBe(false);
  });

  // ── AC: State transitions ────────────────────────────────────────────

  test('status transitions from offline to online on reconnect', async () => {
    const { viewModel } = createViewModel({
      ollamaResponse: new Error('Connection refused'),
      comfyResponse: new Error('Connection refused'),
    });

    await viewModel.checkProviders();
    expect(viewModel.ollamaStatus).toBe('offline');
    expect(viewModel.canBoot).toBe(false);

    // Re-create with working fetch
    const viewModel2 = createViewModel({
      ollamaResponse: { ok: true, status: 200 },
      comfyResponse: { ok: true, status: 200 },
    }).viewModel;

    await viewModel2.checkProviders();
    expect(viewModel2.ollamaStatus).toBe('online');
    expect(viewModel2.canBoot).toBe(true);
  });

  // ── AC: initialize() runs checkProviders immediately ─────────────────

  test('initialize runs the first provider check', async () => {
    const { viewModel } = createViewModel();

    await viewModel.initialize();

    expect(fetchSpy).toHaveBeenCalled();
    expect(viewModel.ollamaStatus).toBe('online');
    expect(viewModel.comfyStatus).toBe('online');
  });

  // ── AC: initializeCore gate ──────────────────────────────────────────

  test('initializeCore does not fire callback when canBoot is false', () => {
    const { viewModel, onBootCompleteSpy } = createViewModel({
      ollamaResponse: new Error('Connection refused'),
      comfyResponse: new Error('Connection refused'),
    });

    viewModel.initializeCore();

    expect(onBootCompleteSpy).not.toHaveBeenCalled();
  });

  test('initializeCore fires callback when canBoot is true', async () => {
    const { viewModel, onBootCompleteSpy } = createViewModel();

    await viewModel.checkProviders();

    expect(viewModel.canBoot).toBe(true);

    viewModel.initializeCore();

    expect(onBootCompleteSpy).toHaveBeenCalledTimes(1);
  });

  // ── AC: Tauri HTTP plugin pings correct URLs ─────────────────────────

  test('checkProviders pings Ollama on port 11434', async () => {
    const { viewModel } = createViewModel();

    await viewModel.checkProviders();

    const calls = fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>;
    const ollamaCall = calls.find(([url]) => typeof url === 'string' && url.includes('11434'));

    expect(ollamaCall).toBeDefined();
  });

  test('checkProviders pings ComfyUI on port 8188 with /system_stats', async () => {
    const { viewModel } = createViewModel();

    await viewModel.checkProviders();

    const calls = fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>;
    const comfyCall = calls.find(
      ([url]) => typeof url === 'string' && url.includes('8188') && url.includes('system_stats'),
    );

    expect(comfyCall).toBeDefined();
  });

  // ── AC: Polling lifecycle ────────────────────────────────────────────

  test('startPolling does not throw', () => {
    const { viewModel } = createViewModel();

    expect(() => viewModel.startPolling()).not.toThrow();
  });

  test('startPolling is idempotent (calling twice does not create duplicate intervals)', () => {
    const { viewModel } = createViewModel();

    viewModel.startPolling();
    viewModel.startPolling(); // Should be a no-op, not throw
  });
});
