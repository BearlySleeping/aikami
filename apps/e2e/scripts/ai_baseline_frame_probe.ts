// apps/e2e/scripts/ai_baseline_frame_probe.ts
//
// Issue #382: main-thread responsiveness during an AI turn.
//
// 🔴 WHAT THIS MEASURES, AND WHAT IT DOES NOT
//
// It records the gap between consecutive `requestAnimationFrame` callbacks and
// any `longtask` the page reports, over exactly the window in which a dialogue
// turn is in flight. That answers one question: does background provider work
// take CPU away from the CLIENT PROCESS's main thread while the player waits?
//
// It does NOT measure scene complexity, draw calls, or a player walking through
// a map. The benchmark page holds a static map with no input, so this is
// main-thread AVAILABILITY, not gameplay rendering. Reporting it as a gameplay
// frame time would be exactly the weak proxy issue #382 warns about, so the
// report states the limit wherever these numbers appear.
//
// WHY NOT THE ENGINE'S OWN COUNTER
//
// The engine already computes one. `createPixiApp` maintains a rolling
// `frameDurationMs` and `fps` from a ticker callback and returns them as
// `PixiAppInstance.debug`, documented as readable "from any consumer". It is
// not readable: `GameWorld.initialize` keeps `pixiInstance.app` and discards
// `debug`, so nothing downstream can reach it. Plumbing it through would be a
// product change, and this is a measurement PR — so the platform's own
// primitives are used instead and the discarded counter is reported as a gap.
//
// The page-side collector only ACCUMULATES. Every statistic is computed here,
// in Node, from the raw intervals — so the measurement code that can be wrong
// is the code that is unit-testable, and the browser callback stays a
// counter.

import type { Page } from 'playwright';

/** Raw, unprocessed samples for one turn window. */
export type RawFrameSamples = {
  /** `undefined` when the browser has no `longtask` PerformanceObserver. */
  readonly longTaskSupported: boolean;
  readonly frames: readonly number[];
  readonly longTasks: readonly number[];
};

/** One sampled turn's frame cadence, summarised. */
export type FrameProbeResult = {
  readonly frameCount: number;
  readonly frameMedianMs: number | null;
  readonly frameMaxMs: number | null;
  /** Frames longer than 2× the observed median — the dropped-frame proxy. */
  readonly slowFrames: number | null;
  readonly longTaskCount: number | null;
  readonly longTaskTotalMs: number | null;
  readonly longTaskMaxMs: number | null;
  /** Why a figure is absent, when it is. Never silently zero. */
  readonly note?: string;
};

/** The probe, as the scenarios module consumes it. */
export type FrameProbe = {
  readonly reset: (page: Page) => Promise<void>;
  readonly read: (page: Page) => Promise<FrameProbeResult>;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Summarises one turn's raw intervals.
 *
 * An empty frame list is reported as `null` for every derived figure plus an
 * explanatory `note`, never as a median of zero — "the page rendered nothing"
 * and "every frame took 0 ms" are different claims.
 */
export const summarizeFrames = (raw: RawFrameSamples): FrameProbeResult => {
  const sorted = [...raw.frames].sort((a, b) => a - b);
  const middle = sorted.length === 0 ? null : Math.floor(sorted.length / 2);
  const medianMs = middle === null ? null : (sorted[middle] ?? null);
  const maxMs = sorted.length === 0 ? null : (sorted[sorted.length - 1] ?? null);
  const slowFrames =
    medianMs === null ? null : sorted.filter((value) => value > medianMs * 2).length;
  const longTaskCount = raw.longTaskSupported ? raw.longTasks.length : null;
  const longTaskTotalMs = raw.longTaskSupported
    ? raw.longTasks.reduce((total, value) => total + value, 0)
    : null;
  const longTaskMaxMs =
    raw.longTaskSupported && raw.longTasks.length > 0 ? Math.max(...raw.longTasks) : null;

  const notes: string[] = [];
  if (sorted.length === 0) {
    notes.push('the page produced no animation frames in this window');
  }
  if (!raw.longTaskSupported) {
    notes.push('longtask PerformanceObserver unsupported in this browser');
  }

  return {
    frameCount: sorted.length,
    frameMedianMs: medianMs === null ? null : round2(medianMs),
    frameMaxMs: maxMs === null ? null : round2(maxMs),
    slowFrames,
    longTaskCount,
    longTaskTotalMs,
    longTaskMaxMs,
    ...(notes.length === 0 ? {} : { note: notes.join('; ') }),
  };
};

/**
 * Installs the in-page collector.
 *
 * One persistent `requestAnimationFrame` loop and one `longtask` observer,
 * installed ONCE and reset per sample. Re-installing per sample would land the
 * probe's own first-frame cost inside a measured window, which is precisely the
 * kind of self-inflicted artefact this harness exists to avoid.
 */
export const installFrameProbe = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const frames: number[] = [];
    const longTasks: number[] = [];
    let previous = performance.now();
    let longTaskSupported = false;

    requestAnimationFrame(function tick(): void {
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    });

    if (typeof PerformanceObserver === 'function') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(Math.round(entry.duration));
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
        longTaskSupported = true;
      } catch {
        longTaskSupported = false;
      }
    }

    Object.assign(window, {
      __AIKAMI_FRAME_PROBE__: {
        reset: (): void => {
          frames.length = 0;
          longTasks.length = 0;
          previous = performance.now();
        },
        read: (): RawFrameSamples => {
          const snapshot = { longTaskSupported, frames: [...frames], longTasks: [...longTasks] };
          frames.length = 0;
          longTasks.length = 0;
          return snapshot;
        },
      },
    });
  });
};

const readRaw = async (page: Page): Promise<RawFrameSamples | undefined> =>
  await page.evaluate(() => {
    const probe = (
      window as unknown as {
        __AIKAMI_FRAME_PROBE__?: { read(): unknown };
      }
    ).__AIKAMI_FRAME_PROBE__;
    return probe?.read() as RawFrameSamples | undefined;
  });

/** The probe handle the scenarios module takes. */
export const frameProbe = (): FrameProbe => ({
  reset: async (page: Page) => {
    await page.evaluate(() => {
      (
        window as unknown as { __AIKAMI_FRAME_PROBE__?: { reset(): void } }
      ).__AIKAMI_FRAME_PROBE__?.reset();
    });
  },
  read: async (page: Page) => {
    const raw = await readRaw(page);
    if (raw === undefined) {
      return {
        frameCount: 0,
        frameMedianMs: null,
        frameMaxMs: null,
        slowFrames: null,
        longTaskCount: null,
        longTaskTotalMs: null,
        longTaskMaxMs: null,
        note: 'frame probe was not installed; frame-time effect remains unmeasured',
      };
    }
    return summarizeFrames(raw);
  },
});
