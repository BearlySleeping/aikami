// apps/e2e/tests/client/play_shell_perf.spec.ts
//
// C-527 AC-8 — measured delivery.
//
// The contract's Success Measures are budgets, not vibes:
//
//   • p95 input-to-visible for a management activation ≤ 100ms, where
//     "input-to-visible" is the activation event → the first frame in which the
//     REQUESTED section's own panel is laid out and visible (not the shared
//     section body, which exists before any section renders). The measurement
//     is taken INSIDE the page (two rAFs after the state commit) and NOT from
//     the Node-side round trip, which would fold IPC latency into the number.
//   • no new main-thread task > 50ms attributable to shell code, compared
//     against an EQUAL-LENGTH idle control window on the same machine/build
//     with the same observers. There is no fixed "extra task" allowance.
//   • exploration scene frame-time, recorded so a regression can be compared
//     against a before/after artifact. Combat frame-time is NOT sampled here
//     (see the artifact's `frameTimeComparison` note).
//
// The measured numbers are written to `test-results/play-shell-perf.json` so a
// reviewer can diff two runs without re-reading stdout.
//
// Reference machine and runtime are whatever ran this file; the artifact
// records them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { PlayShellPage } from '$pom';

/** Activations sampled for the latency budget. */
const LATENCY_SAMPLES = 30;

/** Seconds of continuous scene sampling for the frame-time budget. */
const SCENE_SAMPLE_SECONDS = 60;

/** The contract's p95 budget, in milliseconds. */
const P95_BUDGET_MS = 100;

/** A main-thread task above this is a long task. */
const LONG_TASK_MS = 50;

/**
 * Seconds of the idle control window AND of the equal-length journey window.
 * The two are compared against each other, so they MUST be the same length.
 */
const OBSERVATION_SECONDS = 10;

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

/**
 * Installs the in-page long-task collector. Returns whether the browser
 * actually supports `longtask` observation — an unsupported environment must
 * be reported as UNVERIFIED, never as an empty (passing) list.
 */
const installCollectors = async (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const sink = window as unknown as { __C527_PERF__?: { longTasks: number[] } };
    sink.__C527_PERF__ = { longTasks: [] };
    if (typeof PerformanceObserver === 'undefined') {
      return false;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          sink.__C527_PERF__?.longTasks.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      return true;
    } catch {
      return false;
    }
  });

/** Reads the long tasks collected so far and RESETS the collector. */
const takeLongTasks = async (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const sink = window as unknown as { __C527_PERF__?: { longTasks: number[] } };
    const taken = sink.__C527_PERF__?.longTasks ?? [];
    if (sink.__C527_PERF__) {
      sink.__C527_PERF__.longTasks = [];
    }
    return taken;
  });

/**
 * Every canonical section maps to the testid of ITS OWN panel. Measuring the
 * shared `management-section-body` would have measured a container that is
 * present before the requested destination renders.
 */
const SECTION_PANEL: Readonly<Record<string, string>> = {
  inventory: 'management-panel-inventory',
  journal: 'management-panel-journal',
  world: 'management-panel-world',
  party: 'management-panel-party',
  character: 'management-panel-character',
};

const SECTIONS = Object.keys(SECTION_PANEL);

/**
 * One activation measured entirely in-page: click the rail control, then wait
 * (bounded) for the REQUESTED panel to be painted and visible, and time that.
 */
const measureActivation = async (
  page: Page,
  tabSelector: string,
  panelSelector: string,
): Promise<{ durationMs: number; painted: boolean }> =>
  page.evaluate(
    async (input: { tabSelector: string; panelSelector: string }) => {
      const target = document.querySelector<HTMLElement>(input.tabSelector);
      if (!target) {
        return { durationMs: Number.NaN, painted: false };
      }
      const start = performance.now();
      target.click();
      let painted = false;
      const deadline = start + 2_000;
      while (performance.now() < deadline) {
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        const panel = document.querySelector<HTMLElement>(input.panelSelector);
        if (
          panel !== null &&
          panel.getBoundingClientRect().width > 0 &&
          panel.offsetParent !== null
        ) {
          painted = true;
          break;
        }
      }
      return { durationMs: performance.now() - start, painted };
    },
    { tabSelector, panelSelector },
  );

/**
 * Samples rAF intervals for `seconds`, the closest main-thread frame pacing
 * signal available without instrumenting the engine's own ticker.
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

/** Continuously switches section for `seconds` in-page, so the window is exact. */
const runJourneyWindow = async (page: Page, seconds: number): Promise<void> =>
  page.evaluate(async (durationSeconds: number) => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[data-testid^="section-tab-"]')];
    if (tabs.length === 0) {
      return;
    }
    const deadline = performance.now() + durationSeconds * 1000;
    let index = 0;
    while (performance.now() < deadline) {
      tabs[index % tabs.length]?.click();
      index += 1;
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  }, seconds);

test.describe('C-527 measured delivery', () => {
  test('shell activation latency, long tasks and scene frame time', async ({ page }) => {
    test.setTimeout(180_000);

    const shell = new PlayShellPage(page);
    await shell.open();
    // Let boot settle so the sample is a warm shell, which is what the contract
    // budgets ("Warm shell/section navigation").
    await page.waitForTimeout(8_000);

    const longTaskSupported = await installCollectors(page);

    // Equal-length idle control window: same observers, same machine, no input.
    await page.waitForTimeout(OBSERVATION_SECONDS * 1000);
    const controlLongTasks = await takeLongTasks(page);

    // Warm EVERY measured destination before sampling, so the 30 samples do
    // not include first-mount/feature-load latency.
    await shell.openManagementHost();
    for (const section of SECTIONS) {
      await shell.openManagementSection(section);
      await expect(page.getByTestId(SECTION_PANEL[section])).toBeVisible();
    }
    await page.waitForTimeout(1_000);

    const samples: number[] = [];
    for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
      const section = SECTIONS[i % SECTIONS.length];
      const result = await measureActivation(
        page,
        `[data-testid="section-tab-${section}"]`,
        `[data-testid="${SECTION_PANEL[section]}"]`,
      );
      expect(result.painted, `section ${section} panel was not visible after activation`).toBe(
        true,
      );
      samples.push(result.durationMs);
    }

    // Equal-length journey window: continuous navigation for exactly the same
    // duration as the control, with the collectors reset first.
    await takeLongTasks(page);
    await runJourneyWindow(page, OBSERVATION_SECONDS);
    const journeyLongTasks = await takeLongTasks(page);

    // Exploration scene frame-time with the shell idle behind the host.
    await page.getByTestId('management-close').click();
    await page.waitForSelector('[data-testid="management-host"]', { state: 'hidden' });
    const sceneFrames = await sampleSceneFrameTime(page, SCENE_SAMPLE_SECONDS);

    const latency = summarise(samples);
    const journeyOverBudget = journeyLongTasks.filter((duration) => duration > LONG_TASK_MS);
    const controlOverBudget = controlLongTasks.filter((duration) => duration > LONG_TASK_MS);

    const artifact = {
      contract: 'C-527',
      measuredAt: new Date().toISOString(),
      method: {
        latency:
          'in-page activation click → requested section panel laid out and visible (two rAFs)',
        longTasks: 'PerformanceObserver longtask; equal-length control vs journey windows',
        frameTime: 'rAF interval p95 (exploration)',
      },
      runtime: {
        viewport: page.viewportSize(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
      },
      activationLatencyMs: latency,
      sceneFrameTimeMs: sceneFrames,
      frameTimeComparison: {
        baseline: 'not captured in this run — a before/after needs a run on the base build',
        exploration: sceneFrames,
        combat: 'not sampled in this run (requires the combat seam + a longer run)',
      },
      longTaskBudget: longTaskSupported ? 'asserted' : 'UNVERIFIED (longtask unsupported)',
      observationSeconds: OBSERVATION_SECONDS,
      controlLongTasksOver50ms: controlOverBudget,
      journeyLongTasksOver50ms: journeyOverBudget,
      controlLongTaskCount: controlLongTasks.length,
      journeyLongTaskCount: journeyLongTasks.length,
      sampleSeconds: SCENE_SAMPLE_SECONDS,
    };
    mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    console.log(`[c527-perf] ${JSON.stringify(artifact)}`);

    // ── Budgets ──
    expect(latency.count).toBe(LATENCY_SAMPLES);
    expect(latency.p95).toBeLessThanOrEqual(P95_BUDGET_MS);
    if (longTaskSupported) {
      // No fixed allowance: the equal-length journey window may not add MORE
      // over-budget tasks than the idle control did.
      expect(journeyOverBudget.length).toBeLessThanOrEqual(controlOverBudget.length);
    } else {
      console.warn('[c527-perf] longtask observation unsupported — long-task budget UNVERIFIED');
    }
    expect(sceneFrames.count).toBeGreaterThan(0);
  });
});
