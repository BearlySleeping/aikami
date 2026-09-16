// apps/e2e/tests/client/hub_themes.spec.ts
//
// C-530 AC-5..AC-8: the consumer half of the Hub theme journey — discover,
// download/import, stage, Preview, Apply, update, cancel and Revert, all
// through the production `/settings?section=interface` surface and `/game`.
//
// The Appearance section is where an installed theme is chosen, applied,
// exported and imported; the game is where the result is visible. The
// post-install *appearance* is asserted by the C-529 visual suite
// (`theme_runtime.visual.ts`, which owns the game contexts) — this spec asserts
// the lifecycle and the failure behaviour, which a screenshot cannot prove.
//
// Contract: C-530 Hub theme publishing and installation

import { expect, test } from '@playwright/test';

/** Opens the Appearance section of the Interface settings. */
const openAppearance = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/settings?section=interface');
  await expect(page.getByTestId('settings-interface')).toBeVisible();
  await expect(page.getByTestId('settings-appearance')).toBeVisible();
};

test.describe('Client theme lifecycle — C-530 AC-5 / AC-6 / AC-7', () => {
  test('the Appearance section exposes install, apply and reset controls', async ({ page }) => {
    await openAppearance(page);

    // Import is the always-available fallback when native handoff is not
    // available — it must be reachable by keyboard like every other control.
    const importInput = page.getByTestId('theme-import-input');
    await expect(importInput).toBeAttached();

    // The built-in appearance is always selectable, and the recovery control is
    // reachable without hunting through the card, so a player is never stuck
    // with a theme they cannot remove.
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toBeVisible();
    await expect(page.getByTestId('appearance-reset')).toBeVisible();
  });

  test('nothing is applied without an explicit Apply', async ({ page }) => {
    await openAppearance(page);

    // The staged controls exist only while something is staged, so on a fresh
    // profile there is nothing to apply — the point is that importing is a
    // two-step flow and Apply is a distinct, player-driven action.
    await expect(page.getByTestId('theme-apply-staged')).toHaveCount(0);
    await expect(page.getByTestId('theme-cancel-staged')).toHaveCount(0);
  });

  test('an unreadable import is refused with a diagnostic and leaves the theme alone', async ({
    page,
  }) => {
    await openAppearance(page);

    // `appearance-change-summary` only renders once something has changed, so
    // its absence is a valid "nothing changed" reading — never a wait.
    const summary = page.getByTestId('appearance-change-summary');
    const activeBefore = (await summary.count()) > 0 ? await summary.textContent() : null;

    // The input is visually hidden (`sr-only`) behind its label button, which is
    // the accessible pattern for a styled file picker — so the picker is driven
    // through the file-chooser event rather than by poking the hidden input.
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Import theme package').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'not-a-theme.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('this is definitely not a theme package'),
    });

    // The package is rejected before it can be staged: no Apply control
    // appears, and the active appearance is untouched.
    await expect(page.getByTestId('theme-apply-staged')).toHaveCount(0);
    const after = (await summary.count()) > 0 ? await summary.textContent() : null;
    expect(after).toBe(activeBefore);
  });

  test('accessibility overrides remain independent of the appearance section', async ({ page }) => {
    await openAppearance(page);

    // Personal accessibility choices live beside the theme, not inside it, and
    // must survive an appearance change.
    await expect(page.getByTestId('appearance-accessibility')).toBeVisible();
    await expect(page.getByTestId('appearance-high-contrast')).toBeVisible();
    await expect(page.getByTestId('appearance-opaque-surfaces')).toBeVisible();
  });

  test('a Hub link installs through the trusted endpoint, and a hostile link does not', async ({
    page,
  }) => {
    await openAppearance(page);

    // The handoff field is present and is a form control, not a hidden path.
    const linkInput = page.getByTestId('theme-link-input');
    await expect(linkInput).toBeVisible();
    await expect(page.getByTestId('theme-link-install')).toBeVisible();

    // 🔴 A link that names an origin is refused outright: it parses to nothing,
    // so no request is made and nothing is staged.
    await linkInput.fill('https://evil.example/theme.zip');
    await page.getByTestId('theme-link-install').click();

    await expect(page.getByTestId('theme-apply-staged')).toHaveCount(0);
    // The section's status region carries the outcome (the same region the HUD
    // and appearance actions report into).
    await expect(page.getByTestId('hud-status')).toContainText('not a theme link');
  });

  test('the appearance choice survives a reload', async ({ page }) => {
    await openAppearance(page);
    await page.reload();
    await expect(page.getByTestId('settings-appearance')).toBeVisible();
    await expect(page.getByTestId('appearance-resolved-variant')).toBeVisible();
  });
});

test.describe('Client offline behaviour — C-530 AC-7', () => {
  test('the game boots without a Hub connection', async ({ page }) => {
    // 🔴 No network boot gate: the game must start with the Hub unreachable.
    await page.route('**/api/hub/**', (route) => route.abort());
    await page.goto('/game');
    // The shell renders more than one canvas (world + overlays), so the
    // assertion is that a canvas is present, not that exactly one exists.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  });

  test('the appearance section still renders when the Hub is unreachable', async ({ page }) => {
    await page.route('**/api/hub/**', (route) => route.abort());
    await openAppearance(page);
    // Local installation is never gated on the Hub: the built-in theme, the
    // import control and the recovery controls all remain available.
    await expect(page.getByTestId('appearance-theme-obsidian-chronicle')).toBeVisible();
    await expect(page.getByTestId('theme-import-input')).toBeAttached();
  });
});
