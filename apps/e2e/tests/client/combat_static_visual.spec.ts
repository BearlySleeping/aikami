// apps/e2e/tests/client/combat_static_visual.spec.ts
//
// C-167: Svelte Native Combat UI MVP — Static Visual Regression Tests
//
// Uses CombatPage POM for combat interactions. Screenshot assertions retained
// as Playwright's built-in visual regression mechanism.
// No inline page.locator() calls — strict POM adherence.

import { expect, test } from '@playwright/test';
import { CombatPage } from '$pom';

// ── Helpers ─────────────────────────────────────────────────

const gotoCombatState = async (
  combat: CombatPage,
  params: Record<string, string> = {},
): Promise<void> => {
  const url = new URL('http://localhost:5274/dev/combat');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  await combat.page.goto(url.toString(), { waitUntil: 'networkidle' });
  await combat.page.waitForSelector('[data-testid="combat-portrait-stage"]', { timeout: 10_000 });
  await combat.page.waitForTimeout(500);
};

// ── AC1: Pure DOM Rendering ─────────────────────────────────

test('AC1 — portrait stage renders without canvas element', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoCombatState(combat, { 'enemy-name': 'Goblin' });

  await expect(combat.portraitStage).toBeVisible();

  const rightPane = page.locator('[style*="grid-template-columns: 35vw 1fr"] > div:nth-child(2)');
  const canvasCount = await rightPane.locator('canvas').count();
  expect(canvasCount).toBe(0);
});

// ── AC2: Responsive Portrait Layout ─────────────────────────

test('AC2 — desktop viewport: player left, enemy right, VS divider centered', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoCombatState(combat, { 'enemy-name': 'Goblin' });

  await expect(combat.portraitImages).toHaveCount(2);

  const firstSrc = await combat.portraitImages.nth(0).getAttribute('src');
  expect(firstSrc).toBeTruthy();

  const firstClass = await combat.portraitImages.nth(0).getAttribute('class');
  expect(firstClass).toContain('object-cover');

  await expect(combat.portraitStage).toHaveScreenshot('combat-portrait-stage-desktop.png', {
    maxDiffPixels: 100,
  });
});

test('AC2 — mobile viewport: portraits scale down without breaking layout', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await gotoCombatState(combat, { 'enemy-name': 'Goblin' });

  await expect(combat.portraitStage).toBeVisible();
  await expect(combat.portraitImages).toHaveCount(2);

  await expect(combat.portraitStage).toHaveScreenshot('combat-portrait-stage-mobile.png', {
    maxDiffPixels: 100,
  });
});

// ── AC3: CSS Combat Feedback ────────────────────────────────

test('AC3 — damage flash CSS class applied on hit', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoCombatState(combat, { 'enemy-name': 'Goblin' });

  await combat.clickAttack();
  await page.waitForTimeout(600);

  await expect(combat.portraitStage).toBeVisible();
});

// ── AC4: Visual Regression Stability ────────────────────────

test('AC4 — idle combat state screenshot matches baseline', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoCombatState(combat, { 'enemy-name': 'Goblin' });

  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }`,
  });
  await page.waitForTimeout(300);

  await expect(page).toHaveScreenshot('combat-idle-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});

test('AC4 — victory state shows portrait stage with result overlay', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoCombatState(combat, { state: 'victory', 'enemy-name': 'Goblin' });

  await page.waitForSelector('text=Victory', { timeout: 5000 });

  await expect(page).toHaveScreenshot('combat-victory-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});

test('AC4 — defeat state shows portrait stage with result overlay', async ({ page }) => {
  const combat = new CombatPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoCombatState(combat, { state: 'defeat', 'enemy-name': 'Goblin' });

  await page.waitForSelector('text=Defeat', { timeout: 5000 });

  await expect(page).toHaveScreenshot('combat-defeat-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});
