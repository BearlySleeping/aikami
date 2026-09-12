// packages/shared/local-ai/src/lib/engines/ace_step_engine.test.ts
// biome-ignore-all lint/style/useNamingConvention: the ACE-Step API uses snake_case fields
//
// C-511 AC-1 — the ACE-Step audio adapter satisfies the shared
// `GenerationEngineClient` contract: audio MIME type, flat audio metadata,
// a modality guard that runs before any HTTP call, and a readable rejection
// for every image-only request field.
//
// The engine's real REST surface (confirmed against ACE-Step's shipped
// `infer-api.py`) is `GET /health` + `POST /generate`; the server writes the
// WAV to `output_path` on its own filesystem, so the bytes are read back
// through an injected `ArtifactReader`.
//
// Contract: C-511 Local Audio Generation Modality

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GenerationRequest } from '@aikami/types';
import { AceStepGenerationEngine, parseWavHeader } from './ace_step_engine.ts';
import { createGenerationEngine, GENERATION_ENGINE_IDS } from './factory.ts';

const _realFetch = globalThis.fetch;
const BASE_URL = 'http://127.0.0.1:8085';

/** Builds a minimal, valid 16-bit PCM WAV file with `frames` silent frames. */
const makeWav = (options: { sampleRate: number; channels: number; frames: number }): Uint8Array => {
  const { sampleRate, channels, frames } = options;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = frames * blockAlign;
  const buffer = new Uint8Array(44 + dataBytes);
  const view = new DataView(buffer.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) {
      buffer[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
};

const WAV_BYTES = makeWav({ sampleRate: 44_100, channels: 2, frames: 44_100 });

const audioRequest = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
  modality: 'audio',
  positivePrompt: 'calm forest exploration loop',
  durationSeconds: 30,
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as Response;

describe('AceStepGenerationEngine (C-511 AC-1)', () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }> = [];
  let generateBody: Record<string, unknown> | undefined;

  /** Installs a fetch mock answering /health and /generate. */
  const mockAceStep = (
    options: { failHealth?: boolean; response?: Record<string, unknown> } = {},
  ): void => {
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options: init });
      if (url.endsWith('/health')) {
        return Promise.resolve(
          options.failHealth ? jsonResponse({}, 500) : jsonResponse({ status: 'healthy' }),
        );
      }
      if (url.endsWith('/generate')) {
        generateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(
          jsonResponse(
            options.response ?? {
              status: 'success',
              output_path: '/models/audio/output/aikami-test.wav',
              message: 'Audio generated successfully',
            },
          ),
        );
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
  };

  const makeEngine = (options: { readArtifact?: () => Promise<Uint8Array> } = {}) =>
    new AceStepGenerationEngine({
      baseUrl: BASE_URL,
      readArtifact: options.readArtifact ?? (async () => WAV_BYTES),
    });

  beforeEach(() => {
    fetchCalls = [];
    generateBody = undefined;
    mockAceStep();
  });

  afterEach(() => {
    globalThis.fetch = _realFetch;
  });

  describe('engine registration', () => {
    test('ace-step is a registered generation engine id', () => {
      expect(GENERATION_ENGINE_IDS).toContain('ace-step');
    });

    test('the factory constructs an ace-step adapter', () => {
      const engine = createGenerationEngine('ace-step', { baseUrl: BASE_URL });
      expect(engine.id).toBe('ace-step');
      expect(engine.modality).toBe('audio');
    });
  });

  describe('health check', () => {
    test('reports healthy when /health answers {"status":"healthy"}', async () => {
      const engine = makeEngine();
      expect(await engine.healthCheck()).toBe(true);
    });

    test('reports unhealthy on a non-ok response', async () => {
      mockAceStep({ failHealth: true });
      const engine = makeEngine();
      expect(await engine.healthCheck()).toBe(false);
    });

    test('never probes when no base URL is configured', async () => {
      const engine = new AceStepGenerationEngine({});
      expect(await engine.healthCheck()).toBe(false);
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe('modality guard runs before any HTTP call', () => {
    test('refuses a non-audio request without touching the network', async () => {
      const engine = makeEngine();
      await expect(
        engine.generate({ modality: 'image', positivePrompt: 'a gate' }),
      ).rejects.toThrow(/audio/);
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe('image-only fields are rejected, never stripped', () => {
    const imageOnlyFields: readonly (keyof GenerationRequest)[] = [
      'width',
      'height',
      'steps',
      'cfgScale',
      'sampler',
      'initImage',
      'mask',
      'referenceImages',
      'loras',
    ];

    for (const field of imageOnlyFields) {
      test(`names "${field}" in the rejection`, async () => {
        const engine = makeEngine();
        const value =
          field === 'loras'
            ? [{ path: 'a.safetensors', multiplier: 1 }]
            : field === 'referenceImages'
              ? ['data:image/png;base64,AAAA']
              : field === 'sampler'
                ? 'euler'
                : 1;
        await expect(
          engine.generate(audioRequest({ [field]: value } as Partial<GenerationRequest>)),
        ).rejects.toThrow(new RegExp(`"${field}"`));
        expect(fetchCalls).toHaveLength(0);
      });
    }
  });

  describe('result shape', () => {
    test('returns audio bytes with a flat audio metadata record', async () => {
      const engine = makeEngine();
      const result = await engine.generate(audioRequest({ seed: 7 }));

      expect(result.engine).toBe('ace-step');
      expect(result.mimeType).toBe('audio/wav');
      expect(result.bytes.length).toBe(WAV_BYTES.length);
      expect(result.metadata.format).toBe('wav');
      expect(result.metadata.sampleRate).toBe(44_100);
      expect(result.metadata.channels).toBe(2);
      expect(typeof result.metadata.durationSeconds).toBe('number');
      expect(result.metadata.durationSeconds as number).toBeCloseTo(1, 1);
      expect(result.metadata.model).toBe('audio-ace-step-v1-3.5b');
      expect(result.seed).toBe(7);
    });

    test('sends the real ACE-Step request fields', async () => {
      const engine = makeEngine();
      await engine.generate(
        audioRequest({
          tags: 'calm, ambient, forest',
          durationSeconds: 45,
          bpm: 90,
          key: 'C minor',
        }),
      );

      expect(generateBody?.checkpoint_path).toBe('/models/audio/ace-step-v1-3.5b');
      expect(generateBody?.audio_duration).toBe(45);
      expect(generateBody?.prompt).toBe('calm, ambient, forest');
      expect(generateBody?.lyrics).toBe('[inst]');
      expect(typeof generateBody?.infer_step).toBe('number');
      expect(Array.isArray(generateBody?.actual_seeds)).toBe(true);
      expect(String(generateBody?.output_path)).toStartWith('/models/audio/output/');
    });

    test('an instrumental request wins over lyrics', async () => {
      const engine = makeEngine();
      await engine.generate(audioRequest({ instrumental: true, lyrics: 'la la la' }));
      expect(generateBody?.lyrics).toBe('[inst]');
    });

    test('vocal lyrics are forwarded when not instrumental', async () => {
      const engine = makeEngine();
      await engine.generate(audioRequest({ lyrics: 'hold the line' }));
      expect(generateBody?.lyrics).toBe('hold the line');
    });

    test('falls back to the compiled prompt when tags are absent', async () => {
      const engine = makeEngine();
      await engine.generate(audioRequest());
      expect(generateBody?.prompt).toBe('calm forest exploration loop');
    });
  });

  describe('failure handling', () => {
    test('fails fast when the engine reports a non-success status', async () => {
      mockAceStep({
        response: { status: 'error', output_path: null, message: 'CUDA out of memory' },
      });
      const engine = makeEngine();
      await expect(engine.generate(audioRequest())).rejects.toThrow(/CUDA out of memory/);
    });

    test('fails fast when no output path is returned', async () => {
      mockAceStep({ response: { status: 'success', output_path: null, message: 'ok' } });
      const engine = makeEngine();
      await expect(engine.generate(audioRequest())).rejects.toThrow(/output path/i);
    });

    test('fails fast when the artifact reader cannot read the output', async () => {
      const engine = makeEngine({
        readArtifact: async () => {
          throw new Error('ENOENT: no such file');
        },
      });
      await expect(engine.generate(audioRequest())).rejects.toThrow(/ENOENT/);
    });

    test('fails fast when no artifact reader is supplied', async () => {
      const engine = new AceStepGenerationEngine({ baseUrl: BASE_URL });
      await expect(engine.generate(audioRequest())).rejects.toThrow(/artifact reader/i);
    });

    test('rejects a model swap at runtime', async () => {
      const engine = makeEngine();
      await expect(engine.generate(audioRequest({ model: 'other-model' }))).rejects.toThrow(
        /other-model/,
      );
    });
  });

  describe('WAV header parsing', () => {
    test('reads sample rate, channels and duration', () => {
      const header = parseWavHeader(makeWav({ sampleRate: 48_000, channels: 1, frames: 24_000 }));
      expect(header).toEqual({
        sampleRate: 48_000,
        channels: 1,
        bitsPerSample: 16,
        durationSeconds: 0.5,
      });
    });

    test('returns undefined for non-WAV bytes', () => {
      expect(parseWavHeader(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    });
  });
});
