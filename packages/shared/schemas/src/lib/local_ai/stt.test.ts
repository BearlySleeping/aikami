// packages/shared/schemas/src/lib/local_ai/stt.test.ts
//
// Schema validation tests for the C-393 STT wire protocol: capabilities
// (AC-4 introspectability), client/server message unions (AC-1/AC-2/AC-5/
// AC-6), error codes, and the fixed audio format. The service and C-359's
// client share these schemas so the wire contract cannot drift.

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  SttCapabilitiesSchema,
  SttClientMessageSchema,
  SttErrorCodeSchema,
  SttServerMessageSchema,
} from './stt.ts';

const check = (schema: unknown, value: unknown): boolean => Value.Check(schema as never, value);

const VALID_CAPABILITIES = {
  streaming: {
    available: true,
    engine: 'moonshine',
    model: 'sherpa-onnx-moonshine-tiny-en-int8',
    languages: ['en'],
    vad: true,
    wordTimestamps: false,
  },
  batch: {
    available: true,
    engine: 'whisper-cpp',
    model: 'ggml-tiny.bin',
    languages: ['en', 'de', 'fr'],
  },
  audio: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' },
  protocolVersion: 1,
};

describe('SttCapabilitiesSchema (AC-4)', () => {
  test('accepts the full capabilities document', () => {
    expect(check(SttCapabilitiesSchema, VALID_CAPABILITIES)).toBe(true);
  });

  test('rejects a future engine value before the schema is extended', () => {
    expect(
      check(SttCapabilitiesSchema, {
        ...VALID_CAPABILITIES,
        streaming: { ...VALID_CAPABILITIES.streaming, engine: 'crisperwhisper' },
      }),
    ).toBe(false);
  });

  test('accepts wordTimestamps true — the seam for a licensed provider (AC contract)', () => {
    // The field exists so a future provider can report true without a
    // protocol change; the SHIPPED engines report false (service-side
    // behaviour, asserted by the smoke test, not this schema).
    expect(
      check(SttCapabilitiesSchema, {
        ...VALID_CAPABILITIES,
        streaming: { ...VALID_CAPABILITIES.streaming, wordTimestamps: true },
      }),
    ).toBe(true);
  });

  test('rejects capabilities missing the vad flag', () => {
    const { vad: _vad, ...withoutVad } = VALID_CAPABILITIES.streaming;
    expect(
      check(SttCapabilitiesSchema, {
        ...VALID_CAPABILITIES,
        streaming: withoutVad,
      }),
    ).toBe(false);
  });

  test('rejects a non-16k audio format', () => {
    expect(
      check(SttCapabilitiesSchema, {
        ...VALID_CAPABILITIES,
        audio: { sampleRate: 44100, channels: 2, encoding: 'pcm_s16le' },
      }),
    ).toBe(false);
  });

  test('rejects an unsupported protocolVersion', () => {
    expect(check(SttCapabilitiesSchema, { ...VALID_CAPABILITIES, protocolVersion: 2 })).toBe(false);
  });
});

describe('SttClientMessageSchema', () => {
  test('accepts a start message', () => {
    expect(check(SttClientMessageSchema, { type: 'start', protocolVersion: 1 })).toBe(true);
  });

  test('accepts a start message with language', () => {
    expect(
      check(SttClientMessageSchema, { type: 'start', language: 'de', protocolVersion: 1 }),
    ).toBe(true);
  });

  test('accepts a stop message', () => {
    expect(check(SttClientMessageSchema, { type: 'stop' })).toBe(true);
  });

  test('rejects an unknown message type', () => {
    expect(check(SttClientMessageSchema, { type: 'pause' })).toBe(false);
  });

  test('rejects a start without protocolVersion', () => {
    expect(check(SttClientMessageSchema, { type: 'start' })).toBe(false);
  });

  test('rejects protocolVersion 2', () => {
    expect(check(SttClientMessageSchema, { type: 'start', protocolVersion: 2 })).toBe(false);
  });
});

describe('SttServerMessageSchema', () => {
  const messages = [
    { type: 'ready', capabilities: VALID_CAPABILITIES },
    { type: 'speech-start', atMs: 120 },
    { type: 'partial', text: 'hello', atMs: 1400 },
    { type: 'final', text: 'hello world', startMs: 120, endMs: 2300 },
    { type: 'speech-end', atMs: 2350 },
    { type: 'error', code: 'unsupported-language', message: 'batch is multilingual' },
  ];

  for (const message of messages) {
    test(`accepts ${message.type}`, () => {
      expect(check(SttServerMessageSchema, message)).toBe(true);
    });
  }

  test('rejects a final without endMs', () => {
    expect(check(SttServerMessageSchema, { type: 'final', text: 'x', startMs: 0 })).toBe(false);
  });

  test('rejects an unknown server event', () => {
    expect(check(SttServerMessageSchema, { type: 'error', code: 'oops', message: 'x' })).toBe(
      false,
    );
  });

  test('rejects a bare string frame', () => {
    expect(check(SttServerMessageSchema, 'speech-start')).toBe(false);
  });
});

describe('SttErrorCodeSchema', () => {
  test('accepts every documented code', () => {
    for (const code of [
      'model-not-loaded',
      'unsupported-language',
      'bad-audio-format',
      'protocol-version-mismatch',
      'overloaded',
      'internal',
    ]) {
      expect(check(SttErrorCodeSchema, code)).toBe(true);
    }
  });

  test('rejects an unknown code', () => {
    expect(check(SttErrorCodeSchema, 'no-such-code')).toBe(false);
  });
});
