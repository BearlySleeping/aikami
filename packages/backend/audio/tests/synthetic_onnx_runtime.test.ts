// packages/backend/audio/tests/synthetic_onnx_runtime.test.ts
import { describe, expect, test } from 'bun:test';
import { SyntheticOnnxRuntime } from '../src/lib/synthetic_onnx_runtime.ts';

describe('SyntheticOnnxRuntime', () => {
  test('returns a Float32Array', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result = await runtime.generate({ text: 'Hello world.' });

    expect(result.audio).toBeInstanceOf(Float32Array);
  });

  test('returns 0.1 seconds of audio at 24kHz (2400 samples)', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result = await runtime.generate({ text: 'Hello world.' });

    expect(result.audio.length).toBe(2400);
  });

  test('returns silent audio (all zeros)', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result = await runtime.generate({ text: 'Any text.' });

    let allZero = true;
    for (let i = 0; i < result.audio.length; i++) {
      if (result.audio[i] !== 0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(true);
  });

  test('sample rate is 24000', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result = await runtime.generate({ text: 'Test.' });

    expect(result.sampleRate).toBe(24000);
  });

  test('duration field matches sample count / sample rate', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result = await runtime.generate({ text: 'Test.' });

    expect(result.durationSeconds).toBe(0.1);
  });

  test('custom duration produces correct sample count', async () => {
    const runtime = new SyntheticOnnxRuntime({ defaultDurationSeconds: 0.5 });
    const result = await runtime.generate({ text: 'Longer text.' });

    expect(result.audio.length).toBe(12000); // 24000 * 0.5
    expect(result.durationSeconds).toBe(0.5);
  });

  test('custom sample rate produces correct output', async () => {
    const runtime = new SyntheticOnnxRuntime({ defaultSampleRate: 16000 });
    const result = await runtime.generate({ text: 'Test.' });

    expect(result.audio.length).toBe(1600); // 16000 * 0.1
    expect(result.sampleRate).toBe(16000);
  });

  test('returns unique Float32Array per call (not shared buffer)', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result1 = await runtime.generate({ text: 'A.' });
    const result2 = await runtime.generate({ text: 'B.' });

    // Modify one — should not affect the other
    result1.audio[0] = 0.5;

    expect(result2.audio[0]).toBe(0);
    expect(result1.audio[0]).toBe(0.5);
  });

  test('accepts empty string gracefully', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const result = await runtime.generate({ text: '' });

    expect(result.audio).toBeInstanceOf(Float32Array);
    expect(result.audio.length).toBe(2400);
  });

  test('instant result — resolves synchronously-like', async () => {
    const runtime = new SyntheticOnnxRuntime();
    const start = performance.now();
    await runtime.generate({ text: 'Test.' });
    const elapsed = performance.now() - start;

    // Should be near-instant (< 5ms), no real ONNX inference
    expect(elapsed).toBeLessThan(50);
  });
});
