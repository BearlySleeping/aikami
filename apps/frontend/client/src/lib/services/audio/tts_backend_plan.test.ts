// apps/frontend/client/src/lib/services/audio/tts_backend_plan.test.ts
//
// TtsPlan decides, from configuration alone, which speech backend the
// runtime may use. It was extracted from `tts_service.svelte.ts` verbatim —
// where it was an unreachably complex ladder of early returns interleaved
// with awaits and therefore untestable in isolation.
//
// These are the decisions that must not regress: an unsupported provider and
// an unsafe credential are definitive user-facing failures (not silent
// fallbacks), and a non-loopback voice URL is dropped on desktop only,
// because the packaged CSP cannot reach it.

import { describe, expect, test } from 'bun:test';
import { type ResolveTtsPlanOptions, resolveTtsPlan } from './tts_backend_plan.ts';

const base: ResolveTtsPlanOptions = {
  mode: 'browser',
  serverUrl: undefined,
  providerId: undefined,
  apiKey: undefined,
  isDesktop: false,
};

describe('resolveTtsPlan', () => {
  test('TTS off never probes anything', () => {
    const plan = resolveTtsPlan({ ...base, mode: 'disabled' });
    expect(plan.kind).toBe('disabled');
  });

  test('browser mode is used when no server URL is configured', () => {
    expect(resolveTtsPlan(base).kind).toBe('browser');
    expect(resolveTtsPlan({ ...base, mode: 'server' }).kind).toBe('browser');
  });

  test('a configured server URL produces a normalized server plan', () => {
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'http://localhost:8089/',
      apiKey: 'k',
    });
    expect(plan).toEqual({ kind: 'server', url: 'http://localhost:8089', apiKey: 'k' });
  });

  test('an unsupported provider fails definitively rather than silently falling back', () => {
    // Falling back would POST a Kokoro-shaped request to a provider that
    // speaks a different API — a confusing 404 instead of an honest message.
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'https://api.elevenlabs.io',
      providerId: 'elevenlabs',
    });
    expect(plan.kind).toBe('terminal');
    expect(plan.kind === 'terminal' && plan.retryable).toBe(false);
    expect(plan.kind === 'terminal' && plan.message).toContain('elevenlabs');
  });

  test.each(['kokoro', 'voicevox', 'fish-speech'])('%s is a supported server provider', (id) => {
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'https://voice.example.com',
      providerId: id,
    });
    expect(plan.kind).toBe('server');
  });

  test('a credential over cleartext non-loopback http is refused, not sent', () => {
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'http://voice.example.com',
      apiKey: 'sk-secret',
    });
    expect(plan.kind).toBe('terminal');
    expect(plan.kind === 'terminal' && plan.message).toContain('https://');
  });

  test.each(['http://localhost:8089', 'http://127.0.0.1:8089', 'https://voice.example.com'])(
    'a credential may travel to %s',
    (url) => {
      expect(resolveTtsPlan({ ...base, mode: 'server', serverUrl: url, apiKey: 'k' }).kind).toBe(
        'server',
      );
    },
  );

  test('desktop drops a non-loopback voice URL the CSP would block anyway', () => {
    // Reporting it as a server here would produce a bare CSP violation at
    // request time with no explanation.
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'https://voice.example.com',
      isDesktop: true,
    });
    expect(plan.kind).toBe('browser');
  });

  test('desktop keeps a loopback voice URL (the packaged CSP admits it)', () => {
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'http://localhost:8089',
      isDesktop: true,
    });
    expect(plan.kind).toBe('server');
  });

  test('a browser build is not restricted to loopback', () => {
    const plan = resolveTtsPlan({
      ...base,
      mode: 'server',
      serverUrl: 'https://voice.example.com',
      isDesktop: false,
    });
    expect(plan.kind).toBe('server');
  });
});
