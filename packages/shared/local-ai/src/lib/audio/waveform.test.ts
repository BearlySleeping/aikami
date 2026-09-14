// packages/shared/local-ai/src/lib/audio/waveform.test.ts
//
// C-521 AC-4: the review waveform is drawn from decoded samples, and the seam
// a reviewer is looking for has to be visible in the envelope.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { describe, expect, test } from 'bun:test';
import { computeWaveformPeaks, sampleToSeconds } from './waveform.ts';

describe('computeWaveformPeaks', () => {
  test('returns one peak per bucket, in 0..1', () => {
    const samples = new Float32Array(1_000);
    samples.fill(0.5);
    const peaks = computeWaveformPeaks(samples, 10);
    expect(peaks).toHaveLength(10);
    for (const peak of peaks) {
      expect(peak).toBeCloseTo(0.5, 5);
    }
  });

  test('an empty buffer has nothing to draw', () => {
    expect(computeWaveformPeaks(new Float32Array(0), 10)).toEqual([]);
    expect(computeWaveformPeaks(new Float32Array(100), 0)).toEqual([]);
  });

  test('a transient is preserved rather than averaged away', () => {
    const samples = new Float32Array(1_000);
    samples[500] = 1;
    const peaks = computeWaveformPeaks(samples, 10);
    expect(Math.max(...peaks)).toBe(1);
    // RMS would have reported ~0.03 for that bucket; peaks must not.
    expect(peaks[5] as number).toBeGreaterThan(0.9);
  });

  test('a clipped sample cannot exceed the 0..1 ceiling', () => {
    const samples = new Float32Array(100);
    samples.fill(2);
    expect(Math.max(...computeWaveformPeaks(samples, 10))).toBe(1);
  });

  test('a growing envelope grows monotonically across buckets', () => {
    const samples = new Float32Array(1_000);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index / samples.length;
    }
    const peaks = computeWaveformPeaks(samples, 10);
    for (let index = 1; index < peaks.length; index += 1) {
      expect(peaks[index] as number).toBeGreaterThanOrEqual(peaks[index - 1] as number);
    }
  });

  test('a loop seam reads as two different bucket levels', () => {
    // A quiet head and a loud tail: a reviewer should be able to see the seam
    // the loop joins on.
    const samples = new Float32Array(1_000);
    for (let index = 0; index < 500; index += 1) {
      samples[index] = 0.1;
    }
    for (let index = 500; index < 1_000; index += 1) {
      samples[index] = 0.9;
    }
    const peaks = computeWaveformPeaks(samples, 10);
    expect(peaks[0] as number).toBeCloseTo(0.1, 5);
    expect(peaks[9] as number).toBeCloseTo(0.9, 5);
  });
});

describe('sampleToSeconds', () => {
  test('converts at the buffer rate and guards a zero rate', () => {
    expect(sampleToSeconds(24_000, 48_000)).toBe(0.5);
    expect(sampleToSeconds(24_000, 0)).toBe(0);
  });
});
