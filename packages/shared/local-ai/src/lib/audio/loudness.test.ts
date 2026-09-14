// packages/shared/local-ai/src/lib/audio/loudness.test.ts
//
// C-521 AC-3: the loudness/true-peak measurements are only trustworthy if they
// land where BS.1770-4 says they should on signals whose answer is known
// analytically. These tests pin that.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { describe, expect, test } from 'bun:test';
import { sineWave } from '../__fixtures__/audio_bytes.ts';
import { integratedLoudness, rmsDbfs, samplePeakDb, truePeakDb } from './loudness.ts';

const SAMPLE_RATE = 48_000;

describe('k-weighted integrated loudness (BS.1770-4)', () => {
  test('a -23 dBFS 1 kHz stereo sine measures -23.0 LUFS (EBU Tech 3341 test 1)', () => {
    // EBU Tech 3341's first test signal: a 1 kHz sine at -23 dBFS applied to
    // both channels of a stereo pair must read -23.0 LUFS. This is a real
    // conformance check — the -0.691 dB offset in BS.1770 is cancelled by the
    // K-weighting shelf's ≈+0.7 dB gain at 1 kHz only if the filter is right.
    const amplitude = 10 ** (-23 / 20);
    const channels = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 5,
      amplitudes: [amplitude, amplitude],
    });
    const measured = integratedLoudness(channels, SAMPLE_RATE);
    expect(measured).not.toBeNull();
    expect(measured as number).toBeCloseTo(-23.0, 1);
  });

  test('a -20 dBFS 1 kHz stereo sine measures -20.0 LUFS', () => {
    const amplitude = 10 ** (-20 / 20);
    const channels = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 5,
      amplitudes: [amplitude, amplitude],
    });
    expect(integratedLoudness(channels, SAMPLE_RATE) as number).toBeCloseTo(-20.0, 1);
  });

  test('halving amplitude lowers loudness by ≈6 LU', () => {
    const loud = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 5,
      amplitudes: [0.1, 0.1],
    });
    const quiet = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 5,
      amplitudes: [0.05, 0.05],
    });
    const delta =
      (integratedLoudness(loud, SAMPLE_RATE) as number) -
      (integratedLoudness(quiet, SAMPLE_RATE) as number);
    expect(delta).toBeCloseTo(6.02, 1);
  });

  test('a clip shorter than one 400 ms gating block is unmeasurable, not zero', () => {
    const channels = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 0.2,
      amplitudes: [0.5],
    });
    expect(integratedLoudness(channels, SAMPLE_RATE)).toBeNull();
  });

  test('digital silence is unmeasurable (below the absolute gate), not -Infinity', () => {
    const silence = [new Float32Array(SAMPLE_RATE * 2)];
    expect(integratedLoudness(silence, SAMPLE_RATE)).toBeNull();
  });

  test('a quiet section below the relative gate does not drag the measurement down', () => {
    const loudPart = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 4,
      amplitudes: [0.2],
    });
    const loud = loudPart[0] as Float32Array;
    const combined = new Float32Array(loud.length + SAMPLE_RATE * 4);
    combined.set(loud, 0);
    // Second half is 30 dB quieter — inside the absolute gate but below the
    // relative gate, so it must be excluded rather than averaged in.
    const quiet = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 4,
      amplitudes: [0.2 * 10 ** (-30 / 20)],
    })[0] as Float32Array;
    combined.set(quiet, loud.length);

    const loudOnly = integratedLoudness([loud], SAMPLE_RATE) as number;
    const gated = integratedLoudness([combined], SAMPLE_RATE) as number;
    expect(Math.abs(gated - loudOnly)).toBeLessThan(0.5);
  });

  test('uses the surround channel weight in both gating and final loudness', () => {
    const signal = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      amplitudes: [0.1],
    })[0] as Float32Array;
    const silence = (): Float32Array => new Float32Array(signal.length);
    const front = integratedLoudness([signal], SAMPLE_RATE) as number;
    const surround = integratedLoudness(
      [silence(), silence(), silence(), silence(), signal, silence()],
      SAMPLE_RATE,
    ) as number;

    expect(surround - front).toBeCloseTo(10 * Math.log10(1.41), 1);
  });
});

describe('true peak (BS.1770-4 Annex 2 oversampling)', () => {
  test('reports the inter-sample peak a sample-peak scan misses', () => {
    // fs/4 sine offset by 45°: every sample lands on ±0.7071 (-3.01 dBFS) while
    // the reconstructed waveform peaks at full scale, exactly half a sample
    // after sample 0. An oversampler must see ≈0 dBTP; a naive sample scan
    // sees -3.01 dBFS.
    const channels = sineWave({
      frequency: SAMPLE_RATE / 4,
      sampleRate: SAMPLE_RATE,
      seconds: 1,
      amplitudes: [1],
      phase: Math.PI / 4,
    });
    const samplePeak = samplePeakDb(channels) as number;
    const truePeak = truePeakDb(channels) as number;
    expect(samplePeak).toBeCloseTo(-3.01, 1);
    expect(truePeak).toBeGreaterThan(-0.5);
    expect(truePeak).toBeLessThan(0.5);
  });

  test('a peak-aligned sine reports true peak ≈0 dBTP', () => {
    const channels = sineWave({
      frequency: SAMPLE_RATE / 4,
      sampleRate: SAMPLE_RATE,
      seconds: 1,
      amplitudes: [1],
    });
    expect(truePeakDb(channels) as number).toBeGreaterThan(-0.5);
  });

  test('a half-scale signal reports ≈-6 dBTP', () => {
    const channels = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 1,
      amplitudes: [0.5],
    });
    expect(truePeakDb(channels) as number).toBeCloseTo(-6.02, 0);
  });

  test('digital silence reports null, never -Infinity', () => {
    expect(truePeakDb([new Float32Array(4800)])).toBeNull();
    expect(samplePeakDb([new Float32Array(4800)])).toBeNull();
    expect(rmsDbfs([new Float32Array(4800)])).toBeNull();
  });

  test('rms of a full-scale sine is ≈-3 dBFS', () => {
    const channels = sineWave({
      frequency: 1000,
      sampleRate: SAMPLE_RATE,
      seconds: 1,
      amplitudes: [1],
    });
    expect(rmsDbfs(channels) as number).toBeCloseTo(-3.01, 0);
  });
});
