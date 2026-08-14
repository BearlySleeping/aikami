/**
 * apps/backend/local-stack/stack/stt_service.test.ts
 *
 * C-393 integration tests against a LIVE STT service (the `stt` compose
 * profile or bin/run-native-stt.sh). Every test is skipped when no service
 * is reachable, so `bun moon run local-stack:test` stays green without the
 * stack; run against a live stack with:
 *
 *   STT_URL=http://127.0.0.1:8087 bun test stack/stt_service.test.ts
 *
 * Fixture: stack/fixtures/stt_test_utterance.wav — 16 kHz mono 16-bit PCM
 * speech, committed (generated from the Kokoro TTS endpoint during C-393
 * implementation). ASR assertions use keyword/edit-distance tolerance, not
 * string equality (Test Hooks).
 *
 * Coverage: AC-1 (partials + final), AC-2 (VAD endpoints), AC-3 (batch
 * OpenAI shape), AC-4 (capabilities schema), AC-5 (language limits), AC-6
 * (bad audio format), AC-9 (Origin rejection), AC-10 (health).
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SttCapabilitiesSchema, type SttServerMessage } from '@aikami/schemas';
import type { SttCapabilities } from '@aikami/types';
import { Value } from 'typebox/value';

const STT_URL = process.env.STT_URL ?? 'http://127.0.0.1:8087';
const FIXTURE = join(import.meta.dir, 'fixtures', 'stt_test_utterance.wav');
const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

/**
 * True when the STT service is up AND STT_URL was explicitly set —
 * otherwise every test is skipped. The explicit env gate keeps the plain
 * `bun test stack/*.test.ts` run (check.sh's unit section, moon CI)
 * hermetic even when a dev stack happens to be running; run the live suite
 * with `STT_URL=http://127.0.0.1:8087 bun test stack/stt_service.test.ts`.
 */
const reachable = process.env.STT_URL
  ? await (async (): Promise<boolean> => {
      try {
        const response = await fetch(`${STT_URL}/health`, { signal: AbortSignal.timeout(1500) });
        return response.ok;
      } catch {
        return false;
      }
    })()
  : false;

const parseWav = (bytes: Uint8Array): { sampleRate: number; channels: number; pcm: Uint8Array } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (bitsPerSample !== 16) {
    throw new Error(`fixture is not 16-bit: ${bitsPerSample}`);
  }
  // Walk RIFF chunks to find 'data' regardless of the header layout.
  let offset = 12;
  let pcm: Uint8Array = new Uint8Array(0);
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (chunkId === 'data') {
      pcm = bytes.slice(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return { sampleRate, channels, pcm };
};

const fixture = existsSync(FIXTURE) ? parseWav(readFileSync(FIXTURE)) : null;

/**
 * Streams PCM chunks over a websocket at real-time pace (the server
 * validates the byte rate, so the test must deliver ~32000 B/s).
 * Returns the parsed server messages until close.
 */
const streamWav = (options: {
  pcm: Uint8Array;
  leadSilenceMs?: number;
  trailSilenceMs?: number;
  start?: Record<string, unknown>;
  /** Wire byte rate to simulate — defaults to 16k mono (32000 B/s). */
  bytesPerSecond?: number;
}): Promise<SttServerMessage[]> => {
  const {
    pcm,
    leadSilenceMs = 0,
    trailSilenceMs = 0,
    start,
    bytesPerSecond = BYTES_PER_SECOND,
  } = options;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${STT_URL.replace('http', 'ws')}/v1/stream`);
    const events: SttServerMessage[] = [];
    const sendPcm = (bytes: Uint8Array): void => {
      ws.send(bytes);
    };
    const chunkMs = 100;
    const chunkBytes = Math.floor((bytesPerSecond * chunkMs) / 1000 / 2) * 2;

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

    ws.onopen = async () => {
      try {
        ws.send(JSON.stringify({ type: 'start', protocolVersion: 1, ...start }));
        const lead = Math.floor((BYTES_PER_SECOND * leadSilenceMs) / 1000 / 2) * 2;
        for (let i = 0; i < lead; i += chunkBytes) {
          sendPcm(new Uint8Array(Math.min(chunkBytes, lead - i)));
          await sleep(chunkMs * 0.95);
        }
        for (let i = 0; i < pcm.length; i += chunkBytes) {
          sendPcm(pcm.subarray(i, Math.min(i + chunkBytes, pcm.length)));
          await sleep(chunkMs * 0.95);
        }
        const trail = Math.floor((BYTES_PER_SECOND * trailSilenceMs) / 1000 / 2) * 2;
        for (let i = 0; i < trail; i += chunkBytes) {
          sendPcm(new Uint8Array(Math.min(chunkBytes, trail - i)));
          await sleep(chunkMs * 0.95);
        }
        ws.send(JSON.stringify({ type: 'stop' }));
      } catch (error) {
        reject(error);
      }
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          events.push(JSON.parse(event.data) as SttServerMessage);
        } catch {
          // ignore non-JSON frames
        }
      }
    };
    ws.onclose = () => resolve(events);
    ws.onerror = (error) => reject(new Error(`websocket error: ${String(error)}`));
  });
};

/** Levenshtein distance for edit-distance tolerance on ASR output. */
const editDistance = (a: string, b: string): number => {
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
};

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// The service serializes streaming sessions (STT_MAX_SESSIONS=1 by default,
// overloaded beyond that). Bun may run async it() blocks concurrently, so
// the websocket tests must be serialized or they collide on the semaphore.
let wsTestQueue: Promise<void> = Promise.resolve();
const withWs = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = wsTestQueue.then(fn);
  wsTestQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

describe.skipIf(!reachable)('C-393 STT service (live)', () => {
  it('AC-4: GET /v1/capabilities validates against the shared schema', async () => {
    const response = await fetch(`${STT_URL}/v1/capabilities`);
    expect(response.status).toBe(200);
    const caps = (await response.json()) as SttCapabilities;
    expect(Value.Check(SttCapabilitiesSchema, caps)).toBe(true);
    expect(caps.streaming.engine).toBe('moonshine');
    expect(caps.streaming.languages).toEqual(['en']);
    expect(caps.streaming.vad).toBe(true);
    expect(caps.streaming.wordTimestamps).toBe(false);
    expect(caps.batch.engine).toBe('whisper-cpp');
    expect(caps.audio).toEqual({ sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' });
    expect(caps.protocolVersion).toBe(1);
  });

  it('AC-10: GET /health reports ready when models are loaded', async () => {
    const response = await fetch(`${STT_URL}/health`);
    expect(response.status).toBe(200);
  });

  it(
    'AC-1 + AC-2: streaming a spoken sentence yields speech-start, partials, one final, speech-end',
    () =>
      withWs(async () => {
        if (!fixture) {
          throw new Error(`fixture missing: ${FIXTURE}`);
        }
        const events = await streamWav({
          pcm: fixture.pcm,
          leadSilenceMs: 600,
          trailSilenceMs: 800,
        });
        const types = events.map((event) => event.type);
        expect(types).toContain('ready');
        expect(types).toContain('speech-start');
        expect(types).toContain('partial');
        expect(types).toContain('speech-end');
        const finals = events.filter((event) => event.type === 'final');
        expect(finals).toHaveLength(1);
        const final = finals[0] as { type: 'final'; text: string };
        expect(final.text.length).toBeGreaterThan(0);
        // The fixture is the TTS sentence "Hello world, this is a speech
        // recognition test." — compare against the FULL sentence with a
        // proportional edit-distance tolerance (ASR output varies).
        const expected = normalize('hello world this is a speech recognition test');
        const actual = normalize(final.text);
        expect(editDistance(actual, expected)).toBeLessThanOrEqual(
          Math.max(3, expected.length / 3),
        );
      }),
    30000,
  );

  it(
    'AC-2: VAD emits speech-start after leading silence and speech-end after trailing silence',
    () =>
      withWs(async () => {
        if (!fixture) {
          throw new Error(`fixture missing: ${FIXTURE}`);
        }
        const events = await streamWav({
          pcm: fixture.pcm,
          leadSilenceMs: 600,
          trailSilenceMs: 800,
        });
        const start = events.findIndex((event) => event.type === 'speech-start');
        const end = events.findIndex((event) => event.type === 'speech-end');
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        // speech-start must come after `ready` (never inferred by the client).
        expect(events.findIndex((event) => event.type === 'ready')).toBeLessThan(start);
      }),
    30000,
  );

  it('AC-5: language=de is reported as unsupported, not transcribed as English', () =>
    withWs(async () => {
      const events = await streamWav({ pcm: new Uint8Array(0), start: { language: 'de' } });
      const error = events.find((event) => event.type === 'error') as
        | { type: 'error'; code: string; message: string }
        | undefined;
      expect(error).toBeDefined();
      expect(error?.code).toBe('unsupported-language');
      expect(error?.message).toContain('transcriptions');
    }));

  it(
    'AC-6: a 44.1 kHz stereo stream fails fast with bad-audio-format',
    () =>
      withWs(async () => {
        // Synthesize 44.1k stereo PCM (176400 B/s) and stream at that byte rate.
        const seconds = 2;
        const totalBytes = 176400 * seconds;
        const pcm = new Uint8Array(totalBytes);
        for (let i = 0; i < totalBytes; i += 2) {
          pcm[i] = 0x01;
          pcm[i + 1] = 0x02;
        }
        const events = await streamWav({ pcm, bytesPerSecond: 176400 });
        const error = events.find((event) => event.type === 'error') as
          | { type: 'error'; code: string; message: string }
          | undefined;
        expect(error).toBeDefined();
        expect(error?.code).toBe('bad-audio-format');
        expect(error?.message).toContain('16 kHz');
      }),
    20000,
  );

  it('AC-9: a cross-origin websocket connection is rejected before audio', async () => {
    // Assert the HTTP layer of the handshake: a websocket upgrade request
    // with a disallowed Origin must be answered 403 before any audio flows.
    // Headers via Headers.set — HTTP header names are canonical caps.
    const headers = new Headers();
    headers.set('Origin', 'http://evil.example.com');
    headers.set('Upgrade', 'websocket');
    headers.set('Connection', 'Upgrade');
    headers.set('Sec-WebSocket-Key', 'dGhlIHNhbXBsZSBub25jZQ==');
    headers.set('Sec-WebSocket-Version', '13');
    const response = await fetch(`${STT_URL}/v1/stream`, { headers });
    expect(response.status).toBe(403);
  });

  it('AC-3: batch endpoint returns an OpenAI-shaped transcription', async () => {
    if (!fixture) {
      throw new Error(`fixture missing: ${FIXTURE}`);
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([fixture.pcm.buffer as ArrayBuffer], { type: 'audio/wav' }),
      'utterance.wav',
    );
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    const response = await fetch(`${STT_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { text?: string };
    expect(typeof body.text).toBe('string');
    expect((body.text ?? '').length).toBeGreaterThan(0);
    const expected = normalize('hello world this is a speech recognition test');
    const actual = normalize(body.text ?? '');
    expect(editDistance(actual, expected)).toBeLessThanOrEqual(Math.max(3, expected.length / 3));
  }, 60000);
});
