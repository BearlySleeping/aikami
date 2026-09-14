// apps/e2e/tests/client/play_shell.spec.ts
//
// C-527 — Coherent play shell and management navigation.
//
// Production-path journeys on /game: the quiet default HUD, the five-section
// management host, sibling section switching, return-to-play, and the
// responsive/compact variants. These are compiled Playwright assertions, not
// unit tests — they are the only evidence that the shell is wired into the real
// route rather than a sandbox.

import { expect, test, type Page } from '@playwright/test';

/** Waits for the play shell to be interactive (engine booted, HUD mounted). */
const openPlayShell = async (page: Page): Promise<void> => {
  await page.goto('/game');
  await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 30_000 });
  await page.waitForSelector('[data-testid="hud-menu-entry"]', {
    state: 'visible',
    timeout: 30_000,
  });
};

const openHost = async (page: Page): Promise<void> => {
  await page.getByTestId('hud-menu-entry').click();
  await page.waitForSelector('[data-testid="management-host"]', {
    state: 'visible',
    timeout: 10_000,
  });
};

test.describe('C-527 play shell', () => {
  test('quiet-exploration — one labeled Menu entry and stable HUD slots', async ({ page }) => {
    await openPlayShell(page);

    // AC-1: the seven-item permanent management bar is gone.
    await expect(page.locator('[data-testid="management-nav"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="nav-"]')).toHaveCount(0);

    // The labeled Menu entry replaces it.
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
    await expect(page.getByTestId('hud-menu-entry')).toHaveText(/menu/i);

    // Stable named slots own the geometry.
    await expect(page.getByTestId('hud-slot-top-start')).toBeAttached();
    await expect(page.getByTestId('hud-slot-top-end')).toBeAttached();
    await expect(page.getByTestId('hud-slot-bottom-center')).toBeAttached();

    // No management host until the player asks for it.
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
  });

  test('section-switch-and-return — one host, five sections, back to play', async ({ page }) => {
    await openPlayShell(page);
    await openHost(page);

    // Exactly one host, and the rail exposes the five canonical sections.
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    const tabs = page.locator('[data-testid^="section-tab-"]');
    await expect(tabs).toHaveCount(5);
    await expect(page.getByTestId('section-tab-character')).toBeVisible();
    await expect(page.getByTestId('section-tab-inventory')).toBeVisible();
    await expect(page.getByTestId('section-tab-journal')).toBeVisible();
    await expect(page.getByTestId('section-tab-party')).toBeVisible();
    await expect(page.getByTestId('section-tab-world')).toBeVisible();

    // Character is the Menu landing section.
    await expect(page.getByTestId('section-tab-character')).toHaveAttribute('aria-current', 'page');

    // Sibling switch is one activation and replaces rather than stacks.
    await page.getByTestId('section-tab-inventory').click();
    await expect(page.getByTestId('section-tab-inventory')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeVisible();

    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByTestId('section-tab-journal')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Journal' })).toBeVisible();

    // Back returns to play with the HUD intact.
    await page.getByTestId('management-close').click();
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  test('double-activation-idempotent — repeating a section activation never duplicates the host', async ({
    page,
  }) => {
    await openPlayShell(page);
    await openHost(page);

    const inventoryTab = page.getByTestId('section-tab-inventory');
    await inventoryTab.click();
    await inventoryTab.click();
    await inventoryTab.click();

    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="management-section-body"]')).toHaveCount(1);
    // One item workflow owner, not three.
    await expect(page.getByRole('dialog', { name: 'Inventory' })).toHaveCount(1);
  });

  test('focus-pause-scopes — Escape unwinds the host one scope at a time', async ({ page }) => {
    await openPlayShell(page);
    await openHost(page);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  test('reflow-200-text — the rail and its controls stay reachable at 200% text', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPlayShell(page);
    // 200% text scale on the document root.
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await openHost(page);

    await expect(page.getByTestId('management-close')).toBeVisible();
    await expect(page.getByTestId('section-tab-world')).toBeVisible();
    await page.getByTestId('section-tab-world').click();
    await expect(page.getByTestId('section-tab-world')).toHaveAttribute('aria-current', 'page');
  });

  test('touch-management — the Menu entry and section rail are operable at touch size', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlayShell(page);

    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
    await openHost(page);
    await page.getByTestId('section-tab-party').click();

    await expect(page.getByTestId('section-tab-party')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('management-close')).toBeVisible();
  });
});
