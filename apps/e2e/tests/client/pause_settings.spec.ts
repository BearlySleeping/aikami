// apps/e2e/tests/client/pause_settings.spec.ts
// C-554 production pause/settings and accessibility coverage.

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { HudCustomizationPage, SettingsPage } from '$pom';

const seriousAxeViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
};

test.describe('C-554 pause and settings surfaces', () => {
  test('pause prioritizes resume, save feedback, settings, and explains session actions', async ({
    page,
  }) => {
    const hud = new HudCustomizationPage(page);
    await hud.open();
    await hud.openPauseMenu();

    const pause = page.getByTestId('pause-menu');
    await expect(pause).toBeVisible();
    const buttons = pause.getByRole('button');
    await expect(buttons.nth(0)).toHaveText('Resume');
    await expect(pause.getByRole('button', { name: 'Save now' })).toBeVisible();
    await expect(pause.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(pause.getByText(/Last saved|Not saved yet/)).toBeVisible();
    await expect(pause.getByRole('button', { name: 'End Session' })).toBeVisible();
    await expect(pause.getByRole('button', { name: 'Quit to Main Menu' })).toBeVisible();

    await page.getByRole('button', { name: 'Quit to Main Menu' }).click();
    await expect(page.getByText('Quit to Main Menu?')).toBeVisible();
    await expect(page.getByText(/existing local saves stay on this device/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quit' })).toHaveClass(/game-control--neutral/);
    await expect(page.getByRole('button', { name: 'Quit' })).not.toHaveClass(/text-error/);

    expect(await seriousAxeViolations(page)).toEqual([]);
  });

  test('pause opens the single Interface settings destination with HUD controls', async ({
    page,
  }) => {
    const hud = new HudCustomizationPage(page);
    await hud.open();
    await hud.openPauseMenu();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    const settings = page.getByTestId('in-game-settings-root');
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('tab', { name: 'Interface' })).toBeVisible();
    await settings.getByRole('tab', { name: 'Interface' }).click();
    await expect(page.getByTestId('settings-interface')).toBeVisible();
    await expect(page.getByTestId('hud-hide-toggle')).toBeVisible();
    await expect(page.getByTestId('hud-preset-adventure')).toBeVisible();

    expect(await seriousAxeViolations(page)).toEqual([]);
  });

  test('full settings capability detail explains unconfigured state and keeps setup action', async ({
    page,
  }) => {
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.selectAIGroup();
    await settings.sectionTab('Story & Dialogue').click();

    const detail = page.getByTestId('capability-detail-status');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Story & Dialogue');
    await expect(detail).toContainText(/Unavailable|Configured/);
    await expect(detail).toContainText(/remain playable/);
    await expect(
      page.getByRole('button', { name: /Set up a text connection|Change/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New connection' })).toBeVisible();
  });
});
