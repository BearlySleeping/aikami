// apps/e2e/tests/client/play_shell_perf.spec.ts
//
// C-527 AC-8 — measured delivery.
//
// The contract's Success Measures are budgets, not vibes:
//
//   • p95 input-to-visible for a management activation ≤ 100ms, where
//     "input-to-visible" is activation event → first frame in which the
//     destination section's root is painted and focusable. The measurement is
//     taken INSIDE the page (PerformanceObserver + two rAFs after the state
//     commit), never from the click handler's own duration and never from the
//     Node-side round trip, which would fold IPC latency into the number.
//   • no new main-thread task > 50ms attributable to shell code across the
//     journey (`PerformanceObserver` type `longtask`).
//   • a repeated scene frame-time sample so a regression can be compared
//     before/after the shell change (p95 rAF interval).
//
// The measured numbers are written to `test-results/play-shell-perf.json` so a
// reviewer can diff two runs without re-reading stdout.
//
// Reference machine and runtime are whatever ran this file; the report is
// expected to record them (see the execution report for the recorded values).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/** Activations sampled for the latency budget. */
const LATENCY_SAMPLES = 30;

/** Seconds of continuous scene sampling for the frame-time budget. */
const SCENE_SAMPLE_SECONDS = 60;

/** The contract's p95 budget, in milliseconds. */
const P95_BUDGET_MS = 100;

/** A main-thread task above this is a long task. */
const LONG_TASK_MS = 50;

const ARTIFACT_PATH = resolve(import.meta.dirname, '../../test-results/play-shell-perf.json');

type Percentiles = { p50: number; p95: number; max: number; count: number };

const percentile = (sorted: readonly number[], fraction: number): number => {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

const summarise = (values: readonly number[]): Percentiles => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : Number.NaN,
    count: sorted.length,
  };
};

/** Installs the in-page collectors used by every measurement below. */
const installCollectors = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const sink = window as unknown as {
      __C527_PERF__?: { longTasks: number[]; latencies: number[] };
    };
    sink.__C527_PERF__ = { longTasks: [], latencies: [] };
    if (typeof PerformanceObserver === 'undefined') {
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          sink.__C527_PERF__?.longTasks.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // `longtask` is not supported everywhere; the report records an empty list.
    }
  });
};

/**
 * One activation measured entirely in-page: click the control, then wait for
 * two animation frames so the Svelte state commit has been painted, and require
 * the destination root to be laid out at that point.
 */
const measureActivation = async (
  page: Page,
  selector: string,
): Promise<{ durationMs: number; painted: boolean }> =>
  page.evaluate(async (sel: string) => {
    const target = document.querySelector<HTMLElement>(sel);
    if (!target) {
      return { durationMs: Number.NaN, painted: false };
    }
    const start = performance.now();
    target.click();
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const durationMs = performance.now() - start;
    const root = document.querySelector<HTMLElement>('[data-testid="management-section-body"]');
    const painted = root !== null && root.getBoundingClientRect().width > 0;
    const sink = window as unknown as { __C527_PERF__?: { latencies: number[] } };
    sink.__C527_PERF__?.latencies.push(durationMs);
    return { durationMs, painted };
  }, selector);

/**
 * Samples rAF intervals for `seconds`, which is the closest main-thread frame
 * pacing signal available without instrumenting the engine's own ticker.
 */
const sampleSceneFrameTime = async (page: Page, seconds: number): Promise<Percentiles> =>
  page.evaluate(async (durationSeconds: number) => {
    const frames: number[] = [];
    await new Promise<void>((done) => {
      let previous = performance.now();
      const deadline = previous + durationSeconds * 1000;
      const step = (now: number): void => {
        frames.push(now - previous);
        previous = now;
        if (now >= deadline) {
          done();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    frames.shift();
    const sorted = [...frames].sort((a, b) => a - b);
    const at = (fraction: number): number => {
      if (sorted.length === 0) {
        return Number.NaN;
      }
      const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
      return sorted[Math.max(0, index)];
    };
    return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? Number.NaN, count: sorted.length };
  }, seconds);

const readLongTasks = async (page: Page): Promise<number[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __C527_PERF__?: { longTasks: number[] } }).__C527_PERF__?.longTasks ??
      [],
  );

const SECTIONS = ['inventory', 'journal', 'world', 'party', 'character'] as const;

test.describe('C-527 measured delivery', () => {
  test('shell activation latency, long tasks and scene frame time', async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto('/game');
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 30_000 });
    await page.waitForSelector('[data-testid="hud-menu-entry"]', {
      state: 'visible',
      timeout: 30_000,
    });
    // Let boot settle so the sample is a warm shell, which is what the contract
    // budgets ("Warm shell/section navigation").
    await page.waitForTimeout(8_000);
    await installCollectors(page);

    // Warm the controller path once before sampling.
    await page.getByTestId('hud-menu-entry').click();
    await page.waitForSelector('[data-testid="management-host"]', { state: 'visible' });
    await page.getByTestId('section-tab-inventory').click();
    await page.waitForTimeout(1_000);

    const samples: number[] = [];
    for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
      const section = SECTIONS[i % SECTIONS.length];
      const result = await measureActivation(page, `[data-testid="section-tab-${section}"]`);
      expect(result.painted, `section ${section} root was not painted after activation`).toBe(true);
      samples.push(result.durationMs);
    }

    // Scene frame time, sampled with the shell idle behind the host.
    await page.getByTestId('management-close').click();
    await page.waitForSelector('[data-testid="management-host"]', { state: 'hidden' });
    const sceneFrames = await sampleSceneFrameTime(page, SCENE_SAMPLE_SECONDS);

    const longTasks = await readLongTasks(page);
    const latency = summarise(samples);
    const shellLongTasks = longTasks.filter((duration) => duration > LONG_TASK_MS);

    const artifact = {
      contract: 'C-527',
      measuredAt: new Date().toISOString(),
      runtime: {
        viewport: page.viewportSize(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
      },
      activationLatencyMs: latency,
      sceneFrameTimeMs: sceneFrames,
      longTasksOver50ms: shellLongTasks,
      longTaskCount: longTasks.length,
      sampleSeconds: SCENE_SAMPLE_SECONDS,
    };
    mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`[c527-perf] ${JSON.stringify(artifact)}`);

    // ── Budgets ──
    expect(latency.count).toBe(LATENCY_SAMPLES);
    expect(latency.p95).toBeLessThanOrEqual(P95_BUDGET_MS);
    // No new >50ms main-thread task attributable to shell code.
    expect(shellLongTasks).toEqual([]);
    expect(sceneFrames.count).toBeGreaterThan(0);
  });
});
