// apps/e2e/tests/client/ai_telemetry.spec.ts
//
// Issue #382 P0: the critical path must be OBSERVABLE, and what it records must
// be honest about what it does not know.
//
// The dev text sandbox is the right place to assert this: it is where a
// developer issues a real call through the production `textGenerationService`
// and then asks "where did the time go". No provider is reachable in this
// environment, so the recorded call is the FALLBACK path — which is exactly the
// path whose latency and failure accounting have to be measurable.
//
// The properties under test:
//
//   - a real call leaves a traced span (an untraced failure is the failure mode
//     this instrumentation exists to make impossible to miss);
//   - every span states whether its token counts came from the provider or from
//     a character-count estimate, so a cost figure is never mistaken for a bill;
//   - p95/p99 are ABSENT until the sample count supports them — a percentile
//     that cannot be measured must not look measured;
//   - cost stays UNKNOWN while any model in the buffer is unpriced, rather than
//     silently under-reporting;
//   - the buffer's own key set carries no narrative, player content or
//     credential, so it is safe to export.
//
// Run: bun run --cwd apps/e2e test -- --project=client --grep ai_telemetry

import type { TextTelemetrySpan, TextTelemetrySummary } from '@aikami/types';
import { expect, type Page, test } from '@playwright/test';

const readTelemetry = async (page: Page) =>
  page.evaluate(() => {
    const globals: Window & {
      __AIKAMI_TEST__?: {
        getTextTelemetry(): { spans: readonly TextTelemetrySpan[]; summary: TextTelemetrySummary };
      };
    } = window;
    if (!globals.__AIKAMI_TEST__) {
      throw new Error('Text telemetry test seam is unavailable');
    }
    return globals.__AIKAMI_TEST__.getTextTelemetry();
  });

/**
 * Fields whose values could carry narrative, player content or credentials.
 *
 * Checked by KEY, not by value: a span is metadata by construction, so the
 * question is whether a content-bearing key ever appears. A value check would
 * pass a leak of any phrase this test does not already know.
 */
const CONTENT_BEARING_KEYS = [
  'prompt',
  'content',
  'text',
  'message',
  'messages',
  'completion',
  'response',
  'input',
  'output',
  'systemprompt',
  'apikey',
  'authorization',
  'password',
  'secret',
];

const readDiagnostics = async (page: Page) => ({
  calls: Number(await page.getByTestId('diag-calls').innerText()),
  p95: await page.getByTestId('diag-p95').innerText(),
  p99: await page.getByTestId('diag-p99').innerText(),
  deadline: await page.getByTestId('diag-deadline').innerText(),
  errors: await page.getByTestId('diag-errors').innerText(),
  cost: await page.getByTestId('diag-cost').innerText(),
});

test.describe('AI critical-path telemetry (issue #382 P0)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/text', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('text-diagnostics')).toBeVisible({ timeout: 20_000 });
  });

  test('an unmeasured buffer reports absent percentiles, not zeroed ones', async ({ page }) => {
    const before = await readDiagnostics(page);

    // A percentile over zero samples is UNKNOWN, not zero. Publishing `0` would
    // be a measurement nobody took, and it would read as "everything is fast".
    expect(before.calls).toBe(0);
    expect(before.p95).toBe('—');
    expect(before.p99).toBe('—');
  });

  test('a real call is traced, and its span declares its token provenance', async ({ page }) => {
    await page.getByPlaceholder('Enter your prompt here...').fill('Hello, traveller');
    await page.getByRole('button', { name: /Generate/i }).click();

    // The call fails in this environment (no provider is configured), and that
    // is the point: a failure must leave a trace rather than vanish.
    await expect(page.getByTestId('diag-calls')).not.toHaveText('0', { timeout: 30_000 });
    await expect(page.getByTestId('diag-row').first()).toBeVisible();

    const after = await readDiagnostics(page);
    expect(after.calls).toBeGreaterThan(0);
    // With one sample there is still nothing to compute a p95 from.
    expect(after.p95).toBe('—');
    expect(after.p99).toBe('—');

    // Every row declares where its token counts came from, and how the call
    // ended. Neither is inferable from the other.
    const row = page.getByTestId('diag-row').first();
    await expect(row).toContainText(/provider|est/);
    await expect(row).toContainText(/ms/);
  });

  test('cost stays unknown while any model in the buffer is unpriced', async ({ page }) => {
    await page.getByPlaceholder('Enter your prompt here...').fill('A second probe');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.getByTestId('diag-calls')).not.toHaveText('0', { timeout: 30_000 });

    const cost = await page.getByTestId('diag-cost').innerText();
    // No provider is configured here, so no model has a rate. A total that
    // looked complete would be indistinguishable from "this was free".
    expect(cost).toMatch(/^unknown \(\d+\)$|^unknown$/);
  });

  test('clearing the buffer returns the diagnostics to an unmeasured state', async ({ page }) => {
    await page.getByPlaceholder('Enter your prompt here...').fill('A third probe');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.getByTestId('diag-calls')).not.toHaveText('0', { timeout: 30_000 });

    await page.getByTestId('text-diagnostics-clear').click();

    const after = await readDiagnostics(page);
    expect(after.calls).toBe(0);
    expect(after.p95).toBe('—');
    expect(after.p99).toBe('—');
  });

  test('the buffer declares the provenance and privacy it guarantees', async ({ page }) => {
    // What a developer reads must say what the numbers are, or the distinction
    // between an estimate and a bill is invisible in practice.
    const panel = page.getByTestId('text-diagnostics');
    await expect(panel).toContainText(/provider/);
    await expect(panel).toContainText(/character-count estimate/i);
    await expect(panel).toContainText(/Prompts, replies and credentials are never recorded/i);
  });

  test('a repeated call is counted per call, not coalesced into one', async ({ page }) => {
    // The same request fired twice in a row. Coalescing only ever merges calls
    // that are SIMULTANEOUSLY in flight, so the second (sequential) call must
    // still be recorded — otherwise the activity view would under-report real
    // spend, which is the failure mode a result cache would introduce here.
    await page.getByPlaceholder('Enter your prompt here...').fill('repeat me');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.getByTestId('diag-calls')).toHaveText('1', { timeout: 30_000 });

    await page.getByPlaceholder('Enter your prompt here...').fill('repeat me');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.getByTestId('diag-calls')).toHaveText('2', { timeout: 30_000 });

    // Two calls is two samples — still below the percentile threshold, so p95
    // stays absent rather than being computed from noise.
    const after = await readDiagnostics(page);
    expect(after.calls).toBe(2);
    expect(after.p95).toBe('—');
  });
});

test.describe('Telemetry buffer shape (issue #382 P0)', () => {
  test('a recorded span carries no narrative, player content or credentials', async ({ page }) => {
    // The buffer itself is exercised through the diagnostics surface, so this
    // asserts the CONSTRUCTION property over whatever was recorded: a
    // content-bearing KEY is what a leak looks like, and this is the assertion
    // that catches one being introduced.
    await page.goto('/dev/text', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('text-diagnostics')).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('Enter your prompt here...').fill('Sentinel phrase 12345');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.getByTestId('diag-calls')).not.toHaveText('0', { timeout: 30_000 });

    const { spans } = await readTelemetry(page);
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      for (const key of Object.keys(span)) {
        expect(CONTENT_BEARING_KEYS).not.toContain(key.toLowerCase());
      }
    }
  });

  test('rendered rows contain metadata without the prompt', async ({ page }) => {
    await page.goto('/dev/text', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('text-diagnostics')).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('Enter your prompt here...').fill('Sentinel phrase 12345');
    await page.getByRole('button', { name: /Generate/i }).click();
    await expect(page.getByTestId('diag-calls')).not.toHaveText('0', { timeout: 30_000 });

    // The sentinel phrase was typed into the prompt, so if any content leaked
    // into a diagnostic row it would be here.
    const rows = page.getByTestId('diag-row');
    await expect(rows.first()).toBeVisible();
    const rendered = await rows.allInnerTexts();
    for (const row of rendered) {
      expect(row).not.toContain('Sentinel phrase');
      // A row shows the route, the timing, the counts and the outcome — the
      // outcome is the only word-shaped value, and it is a code.
      expect(row.length).toBeLessThan(120);
    }
  });
});

test.describe('Telemetry span schema (issue #382 P0)', () => {
  test('an empty summary zeroes counters and attributes cache hits by layer', async ({ page }) => {
    await page.goto('/dev/text', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('text-diagnostics')).toBeVisible({ timeout: 20_000 });
    const { spans, summary } = await readTelemetry(page);
    expect(spans).toEqual([]);
    expect(summary.count).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(summary.counters).toEqual({
      calls: 0,
      errors: 0,
      deadlineExceeded: 0,
      cancelled: 0,
      fallbacks: 0,
      cacheHits: {
        none: 0,
        'in-flight-dedup': 0,
        'exact-result': 0,
        'provider-prompt-cache': 0,
      },
      maxQueueDepth: 0,
    });
    expect(summary.latency).toEqual({ count: 0, p50Ms: 0 });
    expect(summary.unpricedCount).toBe(0);
  });
});
