// packages/shared/schemas/src/lib/runtime/runtime_engine_config.test.ts
//
// Validates the runtime `config.json` document schema (C-389 AC-3).
// The document must accept partial/missing engine sections, reject unknown
// modes, and reject non-object payloads — a malformed document must be
// detectable so the loader can fall back down the precedence chain.
import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  RuntimeEngineConfigSchema,
  RuntimeVoiceTtsConfigSchema,
  TtsModeSchema,
} from './runtime_engine_config.ts';

const check = (schema: unknown, value: unknown): boolean =>
  Value.Check(schema as never, value);

describe('RuntimeEngineConfigSchema (C-389)', () => {
  test('accepts a full document', () => {
    const doc = {
      text: { url: 'http://10.0.0.5:8080/v1', model: 'qwen3-4b-instruct' },
      image: { url: 'http://10.0.0.5:8188', engine: 'comfyui' },
      voice: { tts: { mode: 'browser', url: null }, stt: { url: null } },
      models: { originUrl: 'https://huggingface.co' },
    };
    expect(check(RuntimeEngineConfigSchema, doc)).toBe(true);
  });

  test('accepts an empty document (everything optional)', () => {
    expect(check(RuntimeEngineConfigSchema, {})).toBe(true);
    // `undefined` is not a document — the loader treats it as "no config".
    expect(check(RuntimeEngineConfigSchema, undefined)).toBe(false);
  });

  test('accepts a partial document with only voice mode', () => {
    expect(check(RuntimeEngineConfigSchema, { voice: { tts: { mode: 'server' } } })).toBe(true);
  });

  test('accepts null url fields (contract example)', () => {
    const doc = {
      voice: { tts: { mode: 'browser', url: null }, stt: { url: null } },
      models: { originUrl: null },
    };
    expect(check(RuntimeEngineConfigSchema, doc)).toBe(true);
  });

  test('rejects an unknown tts mode', () => {
    expect(check(RuntimeVoiceTtsConfigSchema, { mode: 'telepathy' })).toBe(false);
  });

  test('rejects an unknown image engine', () => {
    expect(
      check(RuntimeEngineConfigSchema, { image: { url: 'http://x:1', engine: 'mystery' } }),
    ).toBe(false);
  });

  test('rejects non-string URLs', () => {
    expect(check(RuntimeEngineConfigSchema, { text: { url: 42 } })).toBe(false);
  });

  test('rejects non-http(s) URLs (security)', () => {
    expect(check(RuntimeEngineConfigSchema, { text: { url: 'javascript:alert(1)' } })).toBe(
      false,
    );
    expect(check(RuntimeEngineConfigSchema, { text: { url: 'file:///etc/passwd' } })).toBe(false);
    expect(check(RuntimeEngineConfigSchema, { text: { url: '/api/text' } })).toBe(false);
    expect(check(RuntimeEngineConfigSchema, { text: { url: 'http://localhost:8080/v1' } })).toBe(
      true,
    );
    expect(check(RuntimeEngineConfigSchema, { text: { url: 'https://example.com' } })).toBe(true);
  });

  test('rejects a non-object document', () => {
    expect(check(RuntimeEngineConfigSchema, 'not-a-config')).toBe(false);
  });

  test('TtsModeSchema accepts all valid modes', () => {
    for (const mode of ['browser', 'server', 'disabled']) {
      expect(check(TtsModeSchema, mode)).toBe(true);
    }
  });
});
