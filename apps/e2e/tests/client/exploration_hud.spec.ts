// apps/e2e/tests/client/exploration_hud.spec.ts
// C-555 production HUD, icon, save, and accessibility coverage.

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { HudCustomizationPage, PlayShellPage } from '$pom';

const seriousAxeViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
};

test.describe('C-555 exploration HUD', () => {
  test('default HUD composes vitals, time, Menu, objective and tutorial guidance', async ({
    page,
  }) => {
    const shell = new PlayShellPage(page);
    await shell.open();

    await expect(page.getByTestId('hud-widget-player-status')).toBeVisible();
    await expect(page.getByTestId('hud-widget-party-status')).toBeVisible();
    await expect(page.getByTestId('hud-widget-clock')).toBeVisible();
    await expect(page.getByTestId('hud-menu-entry')).toHaveCount(1);
    await expect(page.getByTestId('hud-widget-objective')).toBeVisible();
    await expect(page.getByTestId('hud-widget-onboarding-hint')).toBeVisible();

    const guidanceStack = await page
      .getByTestId('hud-widget-objective')
      .evaluate((element) => element.parentElement?.dataset.testid);
    const tutorialStack = await page
      .getByTestId('hud-widget-onboarding-hint')
      .evaluate((element) => element.parentElement?.dataset.testid);
    expect(guidanceStack).toBe('hud-anchor-bottom-start');
    expect(tutorialStack).toBe('hud-anchor-bottom-start');

    expect(await seriousAxeViolations(page)).toEqual([]);
  });

  test('pause reports a successful save with the campaign timestamp', async ({ page }) => {
    const hud = new HudCustomizationPage(page);
    await hud.open();
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: { isMapReady?: () => boolean } }
        ).__AIKAMI_TEST__?.isMapReady?.() === true,
      undefined,
      { timeout: 30_000 },
    );
    await hud.openPauseMenu();
    const pause = page.getByTestId('pause-menu');
    await expect(pause).toBeVisible();
    await pause.getByRole('button', { name: 'Save now' }).click();
    await expect(pause.getByText('Game Saved!', { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(pause.getByText(/Last saved/)).toBeVisible();
  });

  test('dialogue keeps the autosave toast clear of its stage at 800x600', async ({ page }) => {
    const shell = new PlayShellPage(page);
    await shell.open();
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: { isMapReady?: () => boolean } }
        ).__AIKAMI_TEST__?.isMapReady?.() === true,
      undefined,
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      const seam = (
        window as unknown as {
          __AIKAMI_TEST__?: {
            loadPackMap(options: { mapId: string; nearX: number; nearY: number }): Promise<boolean>;
          };
        }
      ).__AIKAMI_TEST__;
      return seam?.loadPackMap({ mapId: 'village', nearX: 1056, nearY: 1376 });
    });
    await page.getByTestId('interaction-prompt').waitFor({ state: 'visible', timeout: 15_000 });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.keyboard.press('KeyE');
    await page.getByTestId('dialogue-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    const toast = page.getByRole('alert').filter({ hasText: 'Auto-saved' });
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const overlap = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.game-stage');
      const notice = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find((element) =>
        element.textContent?.includes('Auto-saved'),
      );
      if (!stage || !notice) {
        return Number.POSITIVE_INFINITY;
      }
      const a = stage.getBoundingClientRect();
      const b = notice.getBoundingClientRect();
      return (
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      );
    });
    expect(overlap).toBeLessThanOrEqual(4);
  });

  test('inventory remains accessible while the production route is icon-ready', async ({
    page,
  }) => {
    const shell = new PlayShellPage(page);
    await shell.open();
    await shell.openManagementHost();
    await shell.openManagementSection('inventory');

    await expect(page.getByTestId('inventory-bag')).toBeVisible();
    await expect(page.getByTestId('inventory-empty-state')).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);
  });
});
