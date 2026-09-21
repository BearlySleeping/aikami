// apps/e2e/tests/client/combat_static_visual.spec.ts
//
// C-167: Svelte Native Combat UI MVP — Static Visual Regression Tests
//
// MIGRATED (combat debug workspace consolidation): these cases used to target
// the deleted freeform `/dev/combat` sandbox (`?state=initial|victory|defeat`,
// mock `enemy-name`). The five state intents and the long-label layout probe
// now live in the workspace's FIXTURES mode, which renders the SAME production
// components (`TurnTrackerHeader`, `InitiativeTracker`, `EnrichedLogEntry`,
// `DiceQuickMenu`) from typed fixture projections.
//
// The `PortraitStage` cases (AC1–AC4) targeted a DOM-only portrait stage that
// the deleted sandbox rendered. Fixtures mode has no portrait stage, so those
// cases are REPOINTED at the fixture initiative/log surfaces with the same
// intent (responsive layout is asserted, not a stage that no longer exists).
//
// Uses `CombatDebugPage` for the workspace. Screenshot assertions retained as
// Playwright's built-in visual regression mechanism.

import { expect, test } from '@playwright/test';
import { CombatDebugPage } from '$pom';
import type { CombatDebugFixturePreset } from '$pom/combat_debug_page';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Boots fixtures mode on the requested preset.
 *
 * Fixture presets are UI-selected (there is no `?preset=` URL parameter), so
 * the selector is driven after the workspace shell mounts.
 */
const gotoFixture = async (
  debug: CombatDebugPage,
  preset: CombatDebugFixturePreset,
): Promise<void> => {
  await debug.gotoFixtures();
  await debug.setFixturePreset(preset);
  await debug.expectFixturePreset(preset);
  await debug.page.waitForTimeout(500);
};

// ── AC1: Production components render in fixtures mode ──────

test('AC1 — fixtures mode renders production components without an engine session', async ({
  page,
}) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'initial');

  // The fixture notice is the honest "no live simulation" marker.
  await debug.expectFixtureNotice();
  await expect(debug.fixtureTurnTracker).toBeVisible();
  await expect(debug.fixtureInitiativeTracker).toBeVisible();

  // No engine session boots in fixtures mode.
  await debug.expectNoLiveCanvas();
});

// ── AC2: Responsive fixture layout ──────────────────────────

test('AC2 — desktop viewport: initiative + log render side by side', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'log-filled');

  await expect(debug.fixtureInitiativeTracker).toBeVisible();
  await expect(debug.fixtureEnrichedLogEntries.first()).toBeVisible();

  await expect(debug.page).toHaveScreenshot('combat-fixtures-desktop.png', {
    fullPage: true,
    maxDiffPixels: 100,
  });
});

test('AC2 — mobile viewport: fixture deck stacks without breaking layout', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await gotoFixture(debug, 'log-filled');

  await debug.expectFixtureNotice();
  await expect(debug.fixtureInitiativeTracker).toBeVisible();
  await expect(debug.fixtureEnrichedLogEntries.first()).toBeVisible();

  await expect(debug.page).toHaveScreenshot('combat-fixtures-mobile.png', {
    fullPage: true,
    maxDiffPixels: 100,
  });
});

// ── AC3: Production log presentation ────────────────────────

test('AC3 — enriched log entry renders dice, damage type and value', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'log-filled');

  const firstEntry = debug.fixtureEnrichedLogEntries.first();
  await expect(firstEntry).toBeVisible();
  await expect(firstEntry.locator('.font-bold.font-mono')).toBeVisible();
  await expect(firstEntry).toContainText(/\[\d+ dmg\]/);
});

// ── AC4: Visual Regression Stability ────────────────────────

test('AC4 — initial fixture screenshot matches baseline', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'initial');

  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }`,
  });
  await page.waitForTimeout(300);

  await expect(page).toHaveScreenshot('combat-fixture-initial-state.png', {
    fullPage: true,
    maxDiffPixels: 500,
  });
});

test('AC4 — victory fixture shows the resolved roster', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'victory');

  // The victory fixture authors the enemy at 0 HP and marks it defeated.
  await expect(debug.page.getByText('defeated', { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('combat-fixture-victory-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});

test('AC4 — defeat fixture shows the downed player', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'defeat');

  // The defeat fixture authors the player at 0 HP / downed.
  await expect(debug.fixtureInitiativeTracker).toContainText('0/100');
  await expect(debug.page.getByText('downed', { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('combat-fixture-defeat-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});

test('AC4 — low-hp fixture shows the critical-health player', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'low-hp');

  await expect(debug.fixtureInitiativeTracker).toContainText('3/100');
  await expect(page).toHaveScreenshot('combat-fixture-low-hp-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});

test('AC4 — long-labels fixture keeps overlong names from breaking layout', async ({ page }) => {
  const debug = new CombatDebugPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoFixture(debug, 'long-labels');

  await expect(debug.fixtureInitiativeTracker).toContainText('Northern Marches');
  await expect(page).toHaveScreenshot('combat-fixture-long-labels-state.png', {
    fullPage: true,
    maxDiffPixels: 200,
  });
});
