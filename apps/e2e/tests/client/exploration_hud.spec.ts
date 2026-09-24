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

  test('pause reports a successful save before showing the campaign timestamp', async ({
    page,
  }) => {
    const hud = new HudCustomizationPage(page);
    await hud.open();
    await page.waitForFunction(
      () => {
        const seam = (window as unknown as { __AIKAMI_TEST__?: { isMapReady?: () => boolean } })
          .__AIKAMI_TEST__;
        return typeof seam?.isMapReady === 'function' && seam.isMapReady() === true;
      },
      undefined,
      { timeout: 30_000 },
    );
    await hud.openPauseMenu();
    const pause = page.getByTestId('pause-menu');
    await expect(pause).toBeVisible();
    await pause.getByRole('button', { name: 'Save now' }).click();
    await expect(pause.getByText('Game Saved!', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(pause.getByText(/Last saved/)).toHaveCount(0);
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
