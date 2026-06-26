// apps/e2e/tests/client/combat_visual.spec.ts
//
// C-166: Diegetic Combat Stage — Visual Testing
//
// Uses /dev/layout/combat-split with ?state= URL params for clean
// combat UI screenshots. Validates via AI visual evaluation.
//
// Run via: bunx playwright test --config=playwright.config.ts --project=client-visual tests/client/combat_visual.spec.ts

import { type Page, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274/dev/layout/combat-split';

const gotoPage = async (page: Page, state: string): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}?state=${state}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
};

const screenshot = async (page: Page, filename: string): Promise<void> => {
  await page.screenshot({
    path: `test-results/combat-visual/${filename}`,
    fullPage: false,
  });
};

// ── Tests — each captures a specific visual state ──────────────────────

test('initial combat — sidebar with HP bars and action bar', async ({ page }) => {
  await gotoPage(page, 'initial');
  await screenshot(page, 'combat_initial.png');
});

test('populated combat log with multiple entries', async ({ page }) => {
  await gotoPage(page, 'log-filled');
  await screenshot(page, 'combat_log.png');
});

test('low HP state — Player at critical health', async ({ page }) => {
  await gotoPage(page, 'low-hp');
  await screenshot(page, 'combat_low_hp.png');
});

test('victory banner after winning combat', async ({ page }) => {
  await gotoPage(page, 'victory');
  await screenshot(page, 'combat_victory.png');
});

test('defeat banner after losing combat', async ({ page }) => {
  await gotoPage(page, 'defeat');
  await screenshot(page, 'combat_defeat.png');
});
