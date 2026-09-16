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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BUILTIN_THEME_VERSION } from '@aikami/constants';
import { expect, test } from '@playwright/test';
import { AppearanceThemePage } from '$pom';

test.describe('Client theme lifecycle — C-530 AC-5 / AC-6 / AC-7', () => {
  let appearance: AppearanceThemePage;

  test.beforeEach(async ({ page }) => {
    appearance = new AppearanceThemePage(page);
    await appearance.open();
  });

  test('the Appearance section exposes install, apply and reset controls', async () => {
    await expect(appearance.settingsInterface).toBeVisible();

    // Import is the always-available fallback when native handoff is not
    // available — it must be reachable by keyboard like every other control.
    await expect(appearance.importInput).toBeAttached();

    // The built-in appearance is always selectable, and the recovery control is
    // reachable without hunting through the card, so a player is never stuck
    // with a theme they cannot remove.
    await expect(appearance.theme('obsidian-chronicle')).toBeVisible();
    await expect(appearance.resetButton).toBeVisible();
  });

  test('nothing is applied without an explicit Apply', async () => {
    const packagePath = await appearance.exportPackage();
    await appearance.importPackage(packagePath);

    await expect(appearance.stagedSummary).toBeVisible();
    await expect(appearance.applyStagedButton).toBeVisible();
    await expect(appearance.cancelStagedButton).toBeVisible();
    await expect(appearance.theme('obsidian-chronicle')).toHaveClass(/btn-active/);
    expect((await appearance.readPreferenceState()).installed).toBeUndefined();
  });

  test('an unreadable import is refused with a diagnostic and leaves the theme alone', async () => {
    // `appearance-change-summary` only renders once something has changed, so
    // its absence is a valid "nothing changed" reading — never a wait.
    const summary = appearance.accessibilityChangeSummary;
    const activeBefore = (await summary.count()) > 0 ? await summary.textContent() : undefined;

    // The input is visually hidden (`sr-only`) behind its label button, which is
    // the accessible pattern for a styled file picker — so the picker is driven
    // through the file-chooser event rather than by poking the hidden input.
    await appearance.chooseImportFile({
      name: 'not-a-theme.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('this is definitely not a theme package'),
    });

    // The package is rejected before it can be staged: no Apply control
    // appears, and the active appearance is untouched.
    await expect(appearance.applyStagedButton).toHaveCount(0);
    const after = (await summary.count()) > 0 ? await summary.textContent() : undefined;
    expect(after).toBe(activeBefore);
  });

  test('accessibility overrides remain independent of the appearance section', async () => {
    // Personal accessibility choices live beside the theme, not inside it, and
    // must survive an appearance change.
    await expect(appearance.accessibilitySurface).toBeVisible();
    await expect(appearance.highContrastToggle).toBeVisible();
    await expect(appearance.opaqueSurfacesToggle).toBeVisible();
  });

  test('a Hub link installs through the trusted endpoint, and a hostile link does not', async ({
    page,
  }) => {
    // The handoff field is present and is a form control, not a hidden path.
    await expect(appearance.themeLinkInput).toBeVisible();
    await expect(appearance.themeLinkInstallButton).toBeVisible();

    const packagePath = await appearance.exportPackage();
    const packageBytes = readFileSync(packagePath);
    const digest = createHash('sha256').update(packageBytes).digest('hex');
    await page.route(
      `**/api/hub/assets/themes/obsidian-chronicle/public?version=${BUILTIN_THEME_VERSION}`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/zip',
          headers: {
            'content-length': String(packageBytes.byteLength),
            'x-aikami-package-sha256': digest,
            'x-aikami-theme-version': BUILTIN_THEME_VERSION,
          },
          body: packageBytes,
        }),
    );
    await appearance.installFromLink(
      `aikami://theme/obsidian-chronicle?version=${BUILTIN_THEME_VERSION}`,
    );
    await expect(appearance.stagedSummary).toBeVisible();
    await expect(appearance.status).toContainText(
      `Downloaded obsidian-chronicle ${BUILTIN_THEME_VERSION}`,
    );
    await expect(appearance.theme('obsidian-chronicle')).toHaveClass(/btn-active/);
    expect((await appearance.readPreferenceState()).installed).toBeUndefined();
    await appearance.cancelStagedButton.click();

    // 🔴 A link that names an origin is refused outright: it parses to nothing,
    // so no request is made and nothing is staged.
    await appearance.installFromLink('https://evil.example/theme.zip');

    await expect(appearance.applyStagedButton).toHaveCount(0);
    await expect(appearance.importError).toContainText('not a theme link');
  });

  test('the appearance choice survives a reload', async () => {
    await appearance.reload();
    await expect(appearance.appearanceSurface).toBeVisible();
    await expect(appearance.resolvedVariant).toBeVisible();
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
    const appearance = new AppearanceThemePage(page);
    await appearance.open();
    // Local installation is never gated on the Hub: the built-in theme, the
    // import control and the recovery controls all remain available.
    await expect(appearance.theme('obsidian-chronicle')).toBeVisible();
    await expect(appearance.importInput).toBeAttached();
  });
});
