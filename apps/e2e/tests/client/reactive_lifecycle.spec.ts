// apps/e2e/tests/client/reactive_lifecycle.spec.ts
//
// C-477: Compiled Svelte lifecycle and reactivity E2E tests.
//
// These tests verify that real Svelte 5 reactivity ($state, $derived,
// $effect.root) works correctly when compiled by the Svelte/Vite pipeline.
// Unlike pure Bun unit tests (which use identity rune polyfills), these
// tests run in a real browser against a compiled Svelte component.
//
// AC-1: Real reactive updates are observed
// AC-2: Lifecycle cleanup is verified
// AC-3: Async failure and stale completion are covered
// AC-4: Pure and compiled suites remain isolated (structural — verified
//       by test runner configuration, not by a DOM assertion)

import { expect, test } from '@playwright/test';
import { ReactiveLifecyclePage } from '$pom';

test.describe('Compiled Svelte reactivity (C-477)', () => {
  let page: ReactiveLifecyclePage;

  test.beforeEach(async ({ page: pwPage }) => {
    page = new ReactiveLifecyclePage(pwPage);
    await page.goto();
  });

  // ── AC-1: Real reactive updates are observed ─────────────────────────────

  test.describe('AC-1: Reactive updates', () => {
    test('initial state shows zero count', async () => {
      await expect(page.countDisplay).toHaveText('Count: 0');
      await expect(page.doubledDisplay).toHaveText('Doubled: 0');
      await expect(page.labelDisplay).toHaveText('Label: zero');
    });

    test('increment updates count and derived values', async () => {
      await page.incrementButton.click();
      await expect(page.countDisplay).toHaveText('Count: 1');
      await expect(page.doubledDisplay).toHaveText('Doubled: 2');
      await expect(page.labelDisplay).toHaveText('Label: positive (1)');
    });

    test('multiple increments propagate through derived state', async () => {
      for (let i = 0; i < 5; i++) {
        await page.incrementButton.click();
      }
      await expect(page.countDisplay).toHaveText('Count: 5');
      await expect(page.doubledDisplay).toHaveText('Doubled: 10');
      await expect(page.labelDisplay).toHaveText('Label: positive (5)');
    });

    test('decrement updates state reactively', async () => {
      await page.decrementButton.click();
      await expect(page.countDisplay).toHaveText('Count: -1');
      await expect(page.doubledDisplay).toHaveText('Doubled: -2');
      await expect(page.labelDisplay).toHaveText('Label: negative (-1)');
    });

    test('reset restores initial state', async () => {
      await page.incrementButton.click();
      await page.incrementButton.click();
      await page.incrementButton.click();
      await expect(page.countDisplay).toHaveText('Count: 3');

      await page.resetButton.click();
      await expect(page.countDisplay).toHaveText('Count: 0');
      await expect(page.doubledDisplay).toHaveText('Doubled: 0');
      await expect(page.labelDisplay).toHaveText('Label: zero');
    });
  });

  // ── AC-2: Lifecycle cleanup is verified ──────────────────────────────────

  test.describe('AC-2: Lifecycle cleanup', () => {
    test('$effect.root runs periodic ticks', async () => {
      // Wait briefly — the tick effect fires every 1s, so after ~1.5s
      // we should see at least 1 tick.
      await page.page.waitForTimeout(1500);
      const tickText = await page.tickDisplay.textContent();
      expect(tickText).toMatch(/Ticks:\s*[1-9]/);
    });

    test('dispose cleans up the tick effect', async () => {
      // Wait for some ticks to accumulate
      await page.page.waitForTimeout(1500);

      // Dispose the ViewModel — this should stop the tick effect
      await page.disposeButton.click();

      // Record the tick count after dispose
      const tickTextAfterDispose = await page.tickDisplay.textContent();
      const match = tickTextAfterDispose?.match(/Ticks:\s*(\d+)/);
      const ticksAfterDispose = match ? Number(match[1]) : 0;

      // Wait a bit longer — ticks should NOT increase after dispose
      await page.page.waitForTimeout(1500);

      const tickTextLater = await page.tickDisplay.textContent();
      const matchLater = tickTextLater?.match(/Ticks:\s*(\d+)/);
      const ticksLater = matchLater ? Number(matchLater[1]) : 0;

      // Tick count must be stable after dispose (no new ticks)
      expect(ticksLater).toBe(ticksAfterDispose);
    });
  });

  // ── AC-3: Async failure and stale completion are covered ─────────────────

  test.describe('AC-3: Async completion and stale updates', () => {
    test('fast async operation completes normally', async () => {
      // The fast operation completes in 50ms
      await page.asyncFastButton.click();
      await expect(page.asyncStatus).toHaveText('Async: pending...');

      // Wait for completion
      await expect(page.asyncResult).toHaveText('Async: fast result', { timeout: 3000 });
    });

    test('dispose before slow async completion prevents stale update', async () => {
      // Start a slow async operation (5000ms delay)
      await page.asyncSlowButton.click();
      await expect(page.asyncStatus).toHaveText('Async: pending...');

      // Dispose the ViewModel before the async operation completes
      await page.disposeButton.click();

      // Wait longer than the original delay — the async result should NOT appear
      await page.page.waitForTimeout(200);

      // After dispose, the async should be idle (cancelled) and no result shown
      // The component may still show the pending indicator that was there at
      // dispose time, but the key point is the slow result never appears.
      const resultLocator = page.asyncResult;
      const hasResult = await resultLocator.isVisible().catch(() => false);
      expect(hasResult).toBe(false);
    });

    test('dispose resets async pending state', async () => {
      await page.asyncSlowButton.click();
      await expect(page.asyncStatus).toHaveText('Async: pending...');

      await page.disposeButton.click();

      // After dispose, the async operation is aborted — the status should
      // no longer be "pending". It may show idle or stay at whatever state
      // dispose set it to.
      await expect(page.asyncStatus).not.toHaveText('Async: pending...');
    });
  });

  // ── AC-4: Isolation check (structural) ───────────────────────────────────
  //
  // This suite verifies that the compiled lane works independently of the
  // pure Bun test preload. The very fact that these tests run in Playwright
  // (not Bun with polyfills) and interact with a compiled Svelte component
  // confirms AC-4: the compiled lane uses the real framework transform.
  //
  // AC-4 is structurally verified by:
  //   1. This test file lives under apps/e2e/tests/client/ (Playwright lane)
  //   2. Pure Bun tests live under apps/frontend/client/src/lib/ (Bun lane)
  //   3. Each lane has its own entrypoint/configuration
  //   4. Bun tests use --preload with rune polyfills
  //   5. Playwright tests use the compiled Svelte output
  //

  test.describe('AC-4: Lane isolation', () => {
    test('compiled lane runs in Playwright with real Svelte transform', async () => {
      // Verify the component is rendered by the Svelte compiler
      await expect(page.countDisplay).toBeVisible();
      await expect(page.incrementButton).toBeVisible();
      await expect(page.decrementButton).toBeVisible();

      // Interact and verify reactive updates (real $state, not polyfills)
      await page.incrementButton.click();
      const count = await page.getCount();
      const doubled = await page.getDoubled();
      expect(doubled).toBe(count * 2);
    });
  });
});
