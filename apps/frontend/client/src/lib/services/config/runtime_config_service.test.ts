// apps/frontend/client/src/lib/services/config/runtime_config_service.test.ts
//
// Unit tests for the runtime engine config loader (C-389 AC-2, AC-3):
// precedence chain, schema validation, single-warning fallback, and
// null-normalization.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

type FetchCall = { url: string; options?: RequestInit };

const storedConfig = JSON.stringify({
  text: { url: 'http://10.0.0.9:8080/v1' },
  image: { url: 'http://10.0.0.9:8188', engine: 'comfyui' },
  voice: { tts: { mode: 'browser', url: null } },
  models: { originUrl: 'https://huggingface.co' },
});

const setupFetchMock = (options: { status?: number; body?: string }): FetchCall[] => {
  const calls: FetchCall[] = [];
  const { status = 200, body = storedConfig } = options;
  // @ts-expect-error — replacing global fetch
  globalThis.fetch = mock(async (url: string, fetchOptions?: RequestInit) => {
    calls.push({ url, options: fetchOptions });
    if (status === 404) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
};

const resetServiceState = async (): Promise<void> => {
  // Remove dev-server defaults (injected by test_preload) so precedence
  // tests exercise the HTTP/unset rungs deterministically.
  delete process.env.PUBLIC_OLLAMA_BASE_URL;
  delete process.env.PUBLIC_IMAGE_URL;
  delete process.env.PUBLIC_VOICE_URL;
  const mod = await import('./runtime_config_service.svelte.ts');
  const svc = mod.runtimeConfigService as unknown as Record<string, unknown>;
  svc._loadPromise = undefined;
  svc._warnedOnce = false;
  svc.isLoaded = false;
  svc.configSource = 'unset';
  svc.engineConfig = {
    text: { url: undefined, model: undefined },
    image: { url: undefined, engine: 'auto' },
    voice: { tts: { mode: 'browser', url: undefined }, stt: { url: undefined } },
    models: { originUrl: undefined },
  };
  return mod;
};

describe('RuntimeConfigService (C-389)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
    delete (globalThis as Record<string, unknown>).fetch;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).fetch;
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  // -----------------------------------------------------------------------
  // AC-2: runtime config drives the engines
  // -----------------------------------------------------------------------

  test('loads engine URLs from config.json relative to the app origin', async () => {
    const calls = setupFetchMock({});
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    const config = await svc.loadConfig();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toBe('./config.json');
    // The request must bypass the HTTP cache so topology changes take
    // effect without a hard reload.
    expect(calls[0].options?.cache).toBe('no-store');
    expect(config.text?.url).toBe('http://10.0.0.9:8080/v1');
    expect(config.image?.url).toBe('http://10.0.0.9:8188');
    expect(svc.getTextUrl()).toBe('http://10.0.0.9:8080/v1');
    expect(svc.getImageUrl()).toBe('http://10.0.0.9:8188');
    expect(svc.configSource).toBe('http');
    expect(svc.isLoaded).toBe(true);
  });

  test('loadConfig is idempotent — second call reuses the resolved promise', async () => {
    const calls = setupFetchMock({});
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    const first = await svc.loadConfig();
    const second = await svc.loadConfig();

    expect(second).toBe(first);
    expect(calls.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // AC-3: config precedence and safe fallback
  // -----------------------------------------------------------------------

  test('localStorage override wins in dev builds', async () => {
    const override = JSON.stringify({ text: { url: 'http://override:9000/v1' } });
    localStorage.setItem('aikami.runtime_engine_config', override);
    setupFetchMock({});
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    await svc.loadConfig();

    expect(svc.configSource).toBe('localStorage');
    expect(svc.getTextUrl()).toBe('http://override:9000/v1');
    expect(svc.getImageUrl()).toBeUndefined();
  });

  test('404 config.json falls back to unset (rung 5) without crashing', async () => {
    setupFetchMock({ status: 404 });
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    const config = await svc.loadConfig();

    expect(config.text?.url).toBeUndefined();
    expect(config.image?.url).toBeUndefined();
    expect(svc.configSource).toBe('unset');
  });

  test('malformed JSON falls back and logs exactly one warning', async () => {
    setupFetchMock({ body: '{not json' });
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;
    const warn = mock(() => {});
    // @ts-expect-error — inject warn spy
    svc.warn = warn;

    await svc.loadConfig();
    await svc.loadConfig();

    expect(svc.configSource).toBe('unset');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('schema-invalid document falls back to unset', async () => {
    setupFetchMock({ body: JSON.stringify({ text: { url: 42 } }) });
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    await svc.loadConfig();

    expect(svc.configSource).toBe('unset');
    expect(svc.getTextUrl()).toBeUndefined();
  });

  test('Tauri config file is preferred over config.json when present', async () => {
    const tauriConfig = JSON.stringify({ text: { url: 'http://tauri-host:11434/v1' } });
    (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: mock(async (cmd: string) => (cmd === 'read_runtime_config' ? tauriConfig : null)),
    };
    const calls = setupFetchMock({});
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    await svc.loadConfig();

    expect(svc.configSource).toBe('tauri-file');
    expect(svc.getTextUrl()).toBe('http://tauri-host:11434/v1');
    // No HTTP fetch should have been attempted.
    expect(calls.length).toBe(0);
  });

  test('null URL fields normalize to undefined', async () => {
    setupFetchMock({
      body: JSON.stringify({
        text: { url: null },
        voice: { tts: { mode: 'server', url: null }, stt: { url: null } },
      }),
    });
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    await svc.loadConfig();

    expect(svc.getTextUrl()).toBeUndefined();
    expect(svc.getVoiceTtsUrl()).toBeUndefined();
    expect(svc.getSttUrl()).toBeUndefined();
  });

  test('voice tts mode defaults to browser when absent', async () => {
    setupFetchMock({ body: JSON.stringify({ voice: { tts: { url: 'http://x:1' } } }) });
    const mod = await resetServiceState();
    const svc = mod.runtimeConfigService;

    await svc.loadConfig();

    expect(svc.getVoiceTtsMode()).toBe('browser');
    expect(svc.getVoiceTtsUrl()).toBe('http://x:1');
  });
});
