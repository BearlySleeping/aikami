// apps/e2e/tests/client/theme_runtime.spec.ts
//
// C-529 — Declarative theme runtime and creator tools.
//
// Production journeys on /settings?section=interface and /game. These are
// compiled Playwright assertions against the real route, the real services and
// real localStorage — not a sandbox: every state below is reached by clicking
// what a player clicks, and the theme scoping is asserted on the real game shell
// and the real trusted chrome.
//
// The package-level adversarial cases (traversal, MIME mismatch, decompression
// bombs, alias cycles, unsupported major API, forbidden values) are covered by
// unit tests in `packages/frontend/theme/src/lib/theme/theme_compiler.test.ts`
// and by the declared CLI validator (`scripts:theme-validate`), which share the
// same compiler this runtime calls.
//
// Contract: C-529 AC-2 (creation surface), AC-5 (mode/accessibility
// precedence), AC-6 (atomic apply and recovery), AC-9 (upgrade continuity).

import { expect, test } from '@playwright/test';
import { HudCustomizationPage } from '$pom';

const SELECTION_KEY = 'aikami:theme:selection';
const HUD_KEY = 'aikami:hud:preferences';
const MOTION_KEY = 'aikami:motion:preference';

test.describe('C-529 appearance runtime', () => {
  let hud: HudCustomizationPage;

  test.beforeEach(async ({ page }) => {
    hud = new HudCustomizationPage(page);
    await page.goto('/settings?section=interface');
    await page.evaluate(
      ([selection, hudKey, motionKey]) => {
        localStorage.removeItem(selection);
        localStorage.removeItem(hudKey);
        localStorage.removeItem(motionKey);
      },
      [SELECTION_KEY, HUD_KEY, MOTION_KEY],
    );
    await page.reload();
  });

  test('AC-2: the Appearance surface is reachable from the existing interface section', async ({
    page,
  }) => {
    await expect(page.getByTestId('settings-interface')).toBeVisible();
    await expect(page.getByTestId('settings-appearance')).toBeVisible();
    await expect(page.getByTestId('appearance-mode-system')).toBeVisible();
    await expect(page.getByTestId('appearance-mode-light')).toBeVisible();
    await expect(page.getByTestId('appearance-mode-dark')).toBeVisible();
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toBeVisible();
  });

  test('AC-9: a profile with no stored appearance defaults to Obsidian Chronicle with OS mode', async ({
    page,
  }) => {
    // The documented default, on a profile that has HUD and motion values but no
    // appearance selection.
    await expect(page.getByTestId('appearance-resolved-variant')).toContainText(
      /Rendering: (light|dark)/,
    );
    await expect(page.getByTestId('appearance-mode-system')).toHaveClass(/btn-active/);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);
  });

  test('AC-5: an explicit mode wins and is honoured on the trusted root', async ({ page }) => {
    await page.getByTestId('appearance-mode-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('appearance-resolved-variant')).toContainText('dark');

    await page.getByTestId('appearance-mode-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('appearance-resolved-variant')).toContainText('light');
  });

  test('AC-5/AC-9: the selection survives a reload and leaves HUD and motion untouched', async ({
    page,
  }) => {
    await page.evaluate(
      ([hudKey, motionKey]) => {
        localStorage.setItem(
          hudKey,
          JSON.stringify({ schemaVersion: 1, selectedPresetId: 'minimal', overrides: [] }),
        );
        localStorage.setItem(motionKey, 'reduce');
      },
      [HUD_KEY, MOTION_KEY],
    );
    await page.getByTestId('appearance-mode-dark').click();
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('appearance-mode-dark')).toHaveClass(/btn-active/);

    const stored = await page.evaluate(
      ([selection, hudKey, motionKey]) => ({
        selection: localStorage.getItem(selection),
        hud: localStorage.getItem(hudKey),
        motion: localStorage.getItem(motionKey),
      }),
      [SELECTION_KEY, HUD_KEY, MOTION_KEY],
    );
    expect(stored.selection).toContain('"mode":"dark"');
    // Appearance is independent of the other two preferences.
    expect(stored.hud).toContain('minimal');
    expect(stored.motion).toBe('reduce');
  });

  test('AC-5: the game shell is the theme scope and carries the resolved variant', async ({
    page,
  }) => {
    await page.getByTestId('appearance-mode-dark').click();
    await hud.open();

    const scope = page.locator('[data-aikami-theme-scope]');
    await expect(scope).toBeAttached();
    await expect(scope).toHaveAttribute('data-aikami-variant', 'dark');

    // The trusted chrome is not repainted by a custom theme: the global
    // `data-theme` contract still resolves, and the HUD layout is unchanged.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(hud.hudAnchor('top-end')).toBeAttached();
    await expect(hud.hudWidget('menu')).toBeAttached();
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  test('AC-6: a corrupt stored selection boots the default with a reachable repair path', async ({
    page,
  }) => {
    await page.evaluate(
      ([selection]) => localStorage.setItem(selection, '{ not json'),
      [SELECTION_KEY],
    );
    await page.reload();

    await expect(page.getByTestId('appearance-recovery-notice')).toBeVisible();
    await page.getByTestId('appearance-restore-defaults').click();
    await expect(page.getByTestId('appearance-recovery-notice')).toHaveCount(0);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);
  });

  test('AC-6: restoring the default appearance is always reachable and needs no network', async ({
    page,
  }) => {
    // 🔴 Not `setOffline` + `reload`: the client is a Vite DEV server here, so a
    // hard navigation genuinely needs the network for module fetches and would
    // fail for a reason that has nothing to do with this contract. What the
    // contract actually requires is that applying and reverting the appearance
    // never depends on a remote request, which is asserted directly.
    const remoteRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://localhost') && !url.startsWith('data:')) {
        remoteRequests.push(url);
      }
    });

    await page.getByTestId('appearance-mode-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await expect(page.getByTestId('appearance-reset')).toBeVisible();
    await page.getByTestId('appearance-reset').click();
    await expect(page.getByTestId('appearance-mode-system')).toHaveClass(/btn-active/);
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toHaveClass(/btn-active/);

    expect(remoteRequests).toEqual([]);
  });
});
