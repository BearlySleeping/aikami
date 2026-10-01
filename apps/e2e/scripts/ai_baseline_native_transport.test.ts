// apps/e2e/scripts/ai_baseline_native_transport.test.ts
//
// #382 native-transport measurement: the PURE parts of the apparatus.
//
// Nothing here needs a provider, a GPU, or a model. That is the point: the
// functions that decide what a latency number MEANS, and that decide whether a
// number is publishable at all, are the ones a reviewer cannot falsify by
// reading a report. A bug that back-filled `firstVisibleMs` from
// `completionMs` would turn every buffered run into a fabricated TTFT, and it
// would be invisible in the output because the number would look plausible.

import { describe, expect, test } from 'bun:test';
import {
  buildNativeWidthOrder,
  NATIVE_MIN_PERCENTILE_SAMPLES,
  type NativePhaseSample,
  renderNativeTransportMarkdown,
  summarizeNativePhases,
} from './ai_baseline_native_transport.ts';

const sample = (over: Partial<NativePhaseSample> = {}): NativePhaseSample => ({
  sampleId: 's1',
  requestId: 'req-1',
  attemptId: 'att-1',
  provider: 'ollama',
  model: 'ornith-1.5:9b',
  transport: 'ndjson-stream',
  backgroundWidth: 0,
  thermal: 'warm',
  promptChars: 120,
  admissionMs: 0,
  headersMs: 90,
  firstVisibleMs: 5_600,
  lastContentMs: 6_100,
  completionMs: 6_200,
  frameCount: 312,
  thinkingChars: 1_200,
  contentFragments: 40,
  ok: true,
  validOutput: true,
  inputTokens: 22,
  outputTokens: 314,
  cachedSource: 'provider',
  cachedTokens: 18,
  ...over,
});

describe('native phase summary — a buffered run has no first-content time', () => {
  test('a buffered sample contributes NO first-visible measurement', () => {
    const buffered = sample({
      transport: 'buffered-json',
      // Absent, not equal to completionMs. The old route had no such
      // measurement and reporting one would be inventing it.
      firstVisibleMs: undefined,
      completionMs: 9_608,
    });
    const summary = summarizeNativePhases([buffered]);

    expect(summary.firstVisibleCount).toBe(0);
    expect(summary.completionP50Ms).toBe(9_608);
    // The two are never merged.
    expect(summary.firstVisibleP50Ms).toBeUndefined();
  });

  test('a streamed sample DOES contribute one, and the gap is preserved', () => {
    const summary = summarizeNativePhases([sample()]);
    // 90 ms to the first byte, 5 600 ms to the first visible word. Reporting
    // the first as "time to first token" would understate the wait ~60×.
    expect(summary.firstVisibleCount).toBe(1);
    expect(summary.headersP50Ms).toBe(90);
    expect(summary.firstVisibleP50Ms).toBe(5_600);
  });

  test('firstVisibleCount is reported apart from count', () => {
    // A reader seeing `n: 12` next to a missing TTFT must be able to tell
    // "not measured" from "zero".
    const samples = [
      sample(),
      ...Array.from({ length: 4 }, () =>
        sample({ firstVisibleMs: undefined, transport: 'buffered-json' }),
      ),
    ];
    const summary = summarizeNativePhases(samples);
    expect(summary.count).toBe(5);
    expect(summary.firstVisibleCount).toBe(1);
  });
});

describe('native phase summary — percentiles need samples', () => {
  test('no p95 below the minimum sample count', () => {
    const summary = summarizeNativePhases([sample(), sample()]);
    // A p95 over two samples is a lie with two decimal places.
    expect(summary.p95Ms).toBeUndefined();
    expect(summary.p99Ms).toBeUndefined();
    // A median over two samples is just the mean of two, which is honest.
    expect(summary.p50Ms).toBeDefined();
  });

  test('p95 appears once the sample count supports it', () => {
    const samples = Array.from({ length: NATIVE_MIN_PERCENTILE_SAMPLES }, (_, i) =>
      sample({ completionMs: (i + 1) * 100 }),
    );
    const summary = summarizeNativePhases(samples);
    expect(summary.p95Ms).toBe(500);
  });
});

describe('native phase summary — quality is measured, not assumed', () => {
  test('valid-output rate is reported when any sample carries it', () => {
    const summary = summarizeNativePhases([
      sample({ validOutput: true }),
      sample({ validOutput: true }),
      sample({ validOutput: false }),
    ]);
    expect(summary.validOutputRate).toBe(0.667);
  });

  test('a run that never measured validity reports no rate', () => {
    // Absent, not 0. A rate of 0 would say "every output was invalid".
    const summary = summarizeNativePhases([sample({ validOutput: undefined })]);
    expect(summary.validOutputRate).toBeUndefined();
  });
});

describe('renderNativeTransportMarkdown runs from persisted JSON', () => {
  const persisted = {
    generatedAt: '2026-10-01T00:00:00.000Z',
    interrupted: false,
    model: 'ornith-1.5:9b',
    environment: { runtime: 'ollama 0.34.3', quantization: 'Q4_K_M' },
    samples: [sample(), sample({ transport: 'buffered-json', firstVisibleMs: undefined })],
  };

  test('renders a complete run with no provider present', () => {
    const markdown = renderNativeTransportMarkdown(persisted);
    expect(markdown).toContain('ollama 0.34.3');
    expect(markdown).toContain('ndjson-stream');
    expect(markdown).toContain('buffered-json');
    // The buffered bucket must show "not measured", never a number.
    expect(markdown).toContain('not measured');
  });

  test('states the phase definitions, so a number cannot be misread', () => {
    const markdown = renderNativeTransportMarkdown(persisted);
    expect(markdown).toContain('Thinking frames do NOT satisfy it');
    expect(markdown).toContain('never back-filled from `completionMs`');
  });

  test('renders a run with NO samples and says so', () => {
    const markdown = renderNativeTransportMarkdown({
      generatedAt: 'x',
      interrupted: true,
      environment: {},
      samples: [],
    });
    // The residual / no-summary case. An empty table would read as "fast".
    expect(markdown).toContain('**No samples were collected.**');
    expect(markdown).toContain('do not read as final');
  });

  test('labels an INTERRUPTED run as partial', () => {
    const markdown = renderNativeTransportMarkdown({ ...persisted, interrupted: true });
    expect(markdown).toContain('YES — partial run');
  });

  test('lists raw failures and invalid outputs rather than averaging them away', () => {
    const markdown = renderNativeTransportMarkdown({
      ...persisted,
      samples: [
        sample(),
        sample({ ok: false, validOutput: false, failureText: 'context length exceeded' }),
      ],
    });
    expect(markdown).toContain('context length exceeded');
    expect(markdown).toContain('Raw failures and invalid outputs');
  });

  test('reports cached-token provenance and a zero local bill honestly', () => {
    const markdown = renderNativeTransportMarkdown(persisted);
    expect(markdown).toContain('provider-reported');
    expect(markdown).toContain('unknown');
    // A local route's zero is a fact about the route, not a claim of free work.
    expect(markdown).toContain('not** estimated here');
  });

  test('reports thinking characters as observed-and-discarded', () => {
    const markdown = renderNativeTransportMarkdown(persisted);
    expect(markdown).toContain('DISCARDED');
    // Two samples in the fixture, 1 200 thinking characters each.
    expect(markdown).toContain('2400');
  });
});

describe('buildNativeWidthOrder counterbalances the sweep', () => {
  test('emits the requested number of samples per width', () => {
    const order = buildNativeWidthOrder([0, 1, 2, 4], 3);
    expect(order).toHaveLength(12);
    for (const width of [0, 1, 2, 4]) {
      expect(order.filter((value) => value === width)).toHaveLength(3);
    }
  });

  test('no width keeps the same ordinal position across every block', () => {
    // Otherwise "the control always ran first" is a permanent confound on a
    // machine that warms up over the run.
    const widths = [0, 1, 2, 4];
    const order = buildNativeWidthOrder(widths, 4);
    for (const width of widths) {
      const positions = order
        .map((value, index) => (value === width ? index % widths.length : -1))
        .filter((position) => position !== -1);
      expect(new Set(positions).size).toBe(widths.length);
    }
  });

  test('never emits a width that was not requested', () => {
    for (const value of buildNativeWidthOrder([0, 1, 2, 4], 3)) {
      expect([0, 1, 2, 4]).toContain(value);
    }
  });
});
