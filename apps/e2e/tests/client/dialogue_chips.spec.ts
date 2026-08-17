// apps/e2e/tests/client/dialogue_chips.spec.ts
//
// C-417 AC-4: suggestion chips must never require horizontal scrolling to
// discover. The dialogue dev sandbox mounts the PRODUCTION DialogueOverlay;
// `?manyChips=1` makes the mock produce 8 chips — more than fits one row at
// common viewport widths. The chip row must wrap (flex-wrap), keeping every
// chip fully visible with no hidden horizontal overflow.
//
// Run: bun moon run e2e:test-client -- --grep dialogue_chips

import { expect, test } from '@playwright/test';

test.describe('Dialogue suggestion chips overflow (C-417 AC-4)', () => {
  const MANY_CHIPS_URL = '/dev/sandbox/dialogue?manyChips=1';

  /**
   * Closes the sandbox DevTools panel — it is open by default and overlays
   * the right 320px of the viewport at z-50, which could visually block
   * wrapped chips and let allChipsWithinRow pass on hidden elements.
   * Uses a programmatic DOM click: the sandbox chrome's EXPLORE badge
   * (fixed top-right, z-60) intercepts pointer events on the ✕ button.
   */
  const closeDevTools = async (page: import('playwright').Page): Promise<void> => {
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="devtools-close"]')?.click();
    });
  };

  /** Navigates, waits for the overlay, and triggers a turn with 8 chips. */
  const openWithManyChips = async (page: import('playwright').Page): Promise<void> => {
    await page.goto(MANY_CHIPS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { state: 'visible', timeout: 15_000 });
    // Ensure the chips row is unobstructed before any measurement.
    await closeDevTools(page);
    await page.getByText('Ah, a traveler!').waitFor({ state: 'visible', timeout: 10_000 });
    // Send a free-text message so the mock analyzeIntent returns 8 chips.
    await page.locator('textarea').first().fill('Tell me about the ward');
    await page.keyboard.press('Enter');
    // Wait for the chips row to render.
    await page.waitForSelector('[data-testid="suggestion-chips"]', {
      state: 'visible',
      timeout: 10_000,
    });
    // Allow the streaming narrative to settle so chip buttons are enabled.
    await page.waitForTimeout(1200);
  };

  /** Asserts the chips row wraps — no hidden horizontal overflow. */
  const expectNoHiddenScroll = async (page: import('playwright').Page): Promise<void> => {
    const metrics = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="suggestion-chips"]');
      if (!row) {
        return null;
      }
      const chips = row.querySelectorAll('button');
      const rowRect = row.getBoundingClientRect();
      return {
        chipCount: chips.length,
        rowScrollWidth: row.scrollWidth,
        rowClientWidth: row.clientWidth,
        // A wrapped row grows in height; a single overflowing row stays short.
        rowHeight: rowRect.height,
        overflowX: getComputedStyle(row).overflowX,
        // All chips must be fully inside the row's horizontal bounds.
        allChipsWithinRow: [...chips].every((chip) => {
          const r = chip.getBoundingClientRect();
          return r.left >= rowRect.left - 1 && r.right <= rowRect.right + 1;
        }),
      };
    });

    if (!metrics) {
      throw new Error('suggestion-chips row not found');
    }
    expect(metrics.chipCount).toBe(8);
    // The row must not scroll horizontally: no content is clipped off-screen.
    expect(metrics.rowScrollWidth).toBeLessThanOrEqual(metrics.rowClientWidth + 1);
    expect(metrics.allChipsWithinRow).toBe(true);
  };

  test('1280×720: all 8 chips wrap into view with no horizontal scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openWithManyChips(page);
    await expectNoHiddenScroll(page);
    // Every chip is reachable — all 8 render as buttons.
    await expect(page.locator('[data-testid="suggestion-chips"] button')).toHaveCount(8);
  });

  test('800×600: all 8 chips wrap into view with no horizontal scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await openWithManyChips(page);
    await expectNoHiddenScroll(page);
    await expect(page.locator('[data-testid="suggestion-chips"] button')).toHaveCount(8);
  });
});
