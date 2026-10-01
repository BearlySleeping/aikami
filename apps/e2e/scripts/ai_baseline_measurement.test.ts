// apps/e2e/scripts/ai_baseline_measurement.test.ts
//
// Issue #382: unit tests for the measurement apparatus' PURE functions.
//
// Nothing here needs a browser, a client or a provider. That is the point: the
// functions that decide what order a latency experiment runs in, and that decide
// whether a frame-time figure is honest, are the ones a reviewer cannot
// falsify by reading a report. A bug in `buildWidthOrder` would silently bias
// every number in the audit, and a bug in `summarizeFrames` would silently turn
// "no frames" into "0 ms frames".

import { describe, expect, test } from 'bun:test';
import { summarizeFrames } from './ai_baseline_frame_probe.ts';
import { buildWidthOrder, pendingOrderPositions } from './ai_baseline_production_scenarios.ts';
import { renderMarkdown } from './ai_baseline_report.ts';

describe('buildWidthOrder is counterbalanced, not merely shuffled', () => {
  test('every width appears in every ordinal position the same number of times', () => {
    const widths = [0, 1, 2, 4];
    // Four reps PER WIDTH: 16 samples, four per width, four blocks.
    const order = buildWidthOrder(widths, 4);
    expect(order).toHaveLength(16);
    for (const width of widths) {
      const positions = order
        .map((value, index) => (value === width ? index % widths.length : -1))
        .filter((position) => position !== -1);
      expect(positions).toHaveLength(4);
      // One occurrence in each of the four ordinal slots: this is the property
      // that stops "the control always runs first" from being a permanent
      // confound on a machine that warms up.
      expect([...new Set(positions)].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  test('the repetition count is PER WIDTH, not a total', () => {
    // The distinction matters: reading it as a total silently produced n=4 per
    // width from a flag that claimed 16.
    const widths = [0, 1, 2, 4];
    expect(buildWidthOrder(widths, 10)).toHaveLength(40);
    for (const width of widths) {
      expect(buildWidthOrder(widths, 10).filter((value) => value === width)).toHaveLength(10);
    }
  });

  test('it never emits a width that was not requested', () => {
    for (const width of buildWidthOrder([0, 1, 2, 4], 4)) {
      expect([0, 1, 2, 4]).toContain(width);
    }
  });

  test('it honours a zero repetition count', () => {
    expect(buildWidthOrder([0, 1, 2, 4], 0)).toHaveLength(0);
  });

  test('a single width degenerates to a constant sequence', () => {
    expect(buildWidthOrder([4], 3)).toEqual([4, 4, 4]);
  });
});

describe('summarizeFrames keeps "not measured" distinct from "zero"', () => {
  test('an empty window reports nulls and says why, never a zero median', () => {
    const result = summarizeFrames({ longTaskSupported: true, frames: [], longTasks: [] });
    expect(result.frameCount).toBe(0);
    expect(result.frameMedianMs).toBeNull();
    expect(result.frameMaxMs).toBeNull();
    expect(result.slowFrames).toBeNull();
    expect(result.note).toContain('no animation frames');
  });

  test('longtask figures are null — not zero — when the observer is unsupported', () => {
    const result = summarizeFrames({
      longTaskSupported: false,
      frames: [16, 16, 16],
      longTasks: [],
    });
    expect(result.longTaskCount).toBeNull();
    expect(result.longTaskTotalMs).toBeNull();
    expect(result.longTaskMaxMs).toBeNull();
    expect(result.note).toContain('longtask');
  });

  test('median, max and slow-frame count are computed from the intervals', () => {
    // 18 is the median; 40 and 90 are the two frames above 2x it.
    const result = summarizeFrames({
      longTaskSupported: true,
      frames: [16, 18, 18, 18, 40, 90],
      longTasks: [55, 70],
    });
    expect(result.frameCount).toBe(6);
    expect(result.frameMedianMs).toBe(18);
    expect(result.frameMaxMs).toBe(90);
    expect(result.slowFrames).toBe(2);
    expect(result.longTaskCount).toBe(2);
    expect(result.longTaskTotalMs).toBe(125);
    expect(result.longTaskMaxMs).toBe(70);
    expect(result.note).toBeUndefined();
  });

  test('a perfectly even cadence reports no slow frames', () => {
    const result = summarizeFrames({
      longTaskSupported: true,
      frames: [17, 17, 17, 17],
      longTasks: [],
    });
    expect(result.slowFrames).toBe(0);
    expect(result.longTaskMaxMs).toBeNull();
  });
});

describe('renderMarkdown does not invent a measurement', () => {
  const base = {
    label: 'unit',
    environment: {
      gitSha: 'abc',
      gitDescribe: 'abc',
      measuredAt: '2026-01-01T00:00:00.000Z',
      endpoint: 'http://localhost:11434/v1',
      model: 'm',
      modelParameters: '9.0B',
      modelQuantization: 'Q4_K_M',
      modelContextLength: 262144,
      modelBytesOnDisk: 6_550_818_310,
      cpuModel: 'cpu',
      cpuCores: '32',
      totalMemoryGb: '31.1',
      gpu: '',
      repetitions: 1,
    },
  };

  test('an empty wire summary renders as "not measured", not as 0', () => {
    const markdown = renderMarkdown({
      ...base,
      scenarios: {
        S1: {
          description: 'x',
          wire: {
            providerRequests: 0,
            failed: 0,
            aborted: 0,
            abortedMs: 0,
            medianMs: null,
            p95Ms: null,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalCachedTokens: 0,
            rowsWithUsage: 0,
            usageShapes: [],
          },
        },
      },
    });
    expect(markdown).toContain('| median | not measured |');
    expect(markdown).toContain('| p95 | not measured |');
    // A provider that reported no phase counters must read as "unknown", never
    // as a phase that took no time.
    expect(markdown).toContain('| provider generation ms | unknown (provider reported none) |');
    expect(markdown).not.toContain('| provider generation ms | 0 ms |');
    // And a route with no `usage` block must not claim zero cached tokens.
    expect(markdown).toContain('provider reported no cached-token field on this route');
  });

  test('the width sweep is recognised and rendered, not silently skipped', () => {
    const markdown = renderMarkdown({
      ...base,
      scenarios: {
        P2: {
          description: 'x',
          measurementOrder: [0, 1],
          measurementOrderKind: 'k',
          validSamples: 0,
          invalidSamples: 0,
          samples: [],
          byWidth: [],
        },
      },
    });
    expect(markdown).toContain('Measurement order');
    expect(markdown).toContain('0,1');
  });
});

describe('a resumed sweep re-measures by POSITION, not by count', () => {
  // The bug this guards: the checkpoint drops harness-error placeholders, so a
  // count-based skip leaves a permanent hole and reports a full total anyway.
  test('a hole in the middle is re-measured even though the count is lower', () => {
    const order = [0, 1, 2, 4, 1, 2, 4, 0];
    // Positions 0..3 measured, position 4 lost to a dead browser, 5..7 measured.
    const prior = [0, 1, 2, 3, 5, 6, 7].map((orderIndex) => ({ orderIndex, valid: true }));
    expect(pendingOrderPositions(order, prior)).toEqual([4]);
  });

  test('a contiguous suffix needs no guesswork', () => {
    const order = [0, 1, 2, 4];
    const prior = [0, 1].map((orderIndex) => ({ orderIndex, valid: true }));
    expect(pendingOrderPositions(order, prior)).toEqual([2, 3]);
  });

  test('a fully-measured sweep re-measures nothing', () => {
    const order = [0, 1, 2, 4];
    const prior = [0, 1, 2, 3].map((orderIndex) => ({ orderIndex, valid: true }));
    expect(pendingOrderPositions(order, prior)).toEqual([]);
  });

  test('a sample measured but INVALID is kept, not re-rolled', () => {
    const order = [0, 1, 2, 4];
    const prior = [0, 1, 2, 3].map((orderIndex) => ({ orderIndex, valid: orderIndex !== 3 }));
    expect(pendingOrderPositions(order, prior)).toEqual([]);
  });
});
