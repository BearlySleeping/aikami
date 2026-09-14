// packages/shared/local-ai/src/lib/audio/wav_decode.test.ts
//
// C-521 AC-3: measurements must describe the decoded bytes, not the header.
// These tests decode synthetic files whose real content differs from what a
// naive header read would report.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { describe, expect, test } from 'bun:test';
import {
  dcOffsetSignal,
  encodeFloat32Wav,
  encodePcm16Wav,
  sineWave,
  truncateBytes,
} from '../__fixtures__/audio_bytes.ts';
import { decodeWav } from './wav_decode.ts';

const SAMPLE_RATE = 48_000;

describe('decodeWav', () => {
  test('round-trips a 16-bit PCM stereo file into de-interleaved channels', () => {
    const channels = sineWave({
      frequency: 440,
      sampleRate: SAMPLE_RATE,
      seconds: 0.5,
      amplitudes: [0.5, 0.25],
    });
    const decoded = decodeWav(encodePcm16Wav({ channelData: channels, sampleRate: SAMPLE_RATE }));

    expect(decoded.codec).toBe('pcm_s16le');
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.sampleRate).toBe(SAMPLE_RATE);
    expect(decoded.channels).toBe(2);
    expect(decoded.sampleCount).toBe(24_000);
    expect(decoded.durationSeconds).toBeCloseTo(0.5, 5);
    expect(decoded.findings).toEqual([]);
    // Channel order is preserved: the right channel is the quieter one.
    const left = decoded.channelData[0] as Float32Array;
    const right = decoded.channelData[1] as Float32Array;
    expect(Math.abs(left[100] as number)).toBeGreaterThan(Math.abs(right[100] as number));
  });

  test('decodes 32-bit float WAV without quantising', () => {
    // 16-bit quantisation would move 0.123456 past the 4-decimal tolerance.
    const channels = [Float32Array.from([0.123456, -0.654321, 0.987654])];
    const decoded = decodeWav(encodeFloat32Wav({ channelData: channels, sampleRate: SAMPLE_RATE }));
    expect(decoded.codec).toBe('pcm_f32le');
    const decodedChannel = decoded.channelData[0] as Float32Array;
    expect(decodedChannel[0] as number).toBeCloseTo(0.123456, 6);
    expect(decodedChannel[2] as number).toBeCloseTo(0.987654, 6);
  });

  test('a truncated file decodes only the bytes that exist and reports truncation', () => {
    const channels = sineWave({
      frequency: 440,
      sampleRate: SAMPLE_RATE,
      seconds: 1,
      amplitudes: [0.5],
    });
    const full = encodePcm16Wav({ channelData: channels, sampleRate: SAMPLE_RATE });
    const cut = truncateBytes(full, 20_000);
    const decoded = decodeWav(cut);

    const truncated = decoded.findings.find((entry) => entry.code === 'truncated_clip');
    expect(truncated).toBeDefined();
    expect(truncated?.severity).toBe('error');
    // The duration follows the decoded frames, not the header's claim of 1 s.
    expect(decoded.durationSeconds).toBeLessThan(1);
    expect(decoded.sampleCount).toBe(Math.floor((cut.length - 44) / 2));
  });

  test('a data chunk that ends mid-frame is reported as truncation', () => {
    const channels = sineWave({
      frequency: 440,
      sampleRate: SAMPLE_RATE,
      seconds: 0.1,
      amplitudes: [0.5],
    });
    const full = encodePcm16Wav({ channelData: channels, sampleRate: SAMPLE_RATE });
    // Drop 3 bytes: the remaining sample count is not a whole frame boundary
    // for a 2-byte mono frame only if odd — use 3 to leave 1 stray byte.
    const odd = full.slice(0, full.length - 3);
    const decoded = decodeWav(odd);
    expect(decoded.findings.some((entry) => entry.code === 'truncated_clip')).toBe(true);
  });

  test('a zero-length data chunk reports empty_clip', () => {
    const decoded = decodeWav(
      encodePcm16Wav({ channelData: [new Float32Array(0)], sampleRate: SAMPLE_RATE }),
    );
    expect(decoded.sampleCount).toBe(0);
    expect(decoded.findings.some((entry) => entry.code === 'empty_clip')).toBe(true);
  });

  test('non-WAV bytes report unsupported_format instead of throwing', () => {
    const decoded = decodeWav(new TextEncoder().encode('not audio at all, really not'));
    expect(decoded.channels).toBe(0);
    expect(decoded.findings[0]?.code).toBe('unsupported_format');
    expect(decoded.findings[0]?.severity).toBe('error');
  });

  test('a 12-byte file is rejected without reading past the buffer', () => {
    const decoded = decodeWav(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]));
    expect(decoded.sampleCount).toBe(0);
    expect(decoded.findings.length).toBeGreaterThan(0);
  });

  test('a DC-offset signal decodes to its constant value', () => {
    const decoded = decodeWav(
      encodeFloat32Wav({
        channelData: dcOffsetSignal({
          channels: 1,
          sampleRate: SAMPLE_RATE,
          seconds: 0.1,
          offset: 0.2,
        }),
        sampleRate: SAMPLE_RATE,
      }),
    );
    expect(decoded.channelData[0]?.[0] as number).toBeCloseTo(0.2, 6);
  });
});
