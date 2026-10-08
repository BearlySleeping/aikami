// apps/e2e/tests/site/site_editorial.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Editorial homepage navigation', () => {
  test('desktop download CTA reaches the platform downloads with the keyboard', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const desktopLink = page.getByRole('link', { name: 'Download for desktop', exact: true });
    await desktopLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#download$/);
    await expect(page.getByRole('heading', { name: 'Download for desktop.' })).toBeInViewport();
    const downloads = page.locator('#download');
    await expect(downloads.getByRole('link', { name: /^Download for Windows/ })).toHaveAttribute(
      'href',
      /aikami\.exe$/,
    );
    await expect(downloads.getByRole('link', { name: /^Download for macOS/ })).toHaveAttribute(
      'href',
      /aikami\.dmg$/,
    );
    await expect(downloads.getByRole('link', { name: /^Download for Linux/ })).toHaveAttribute(
      'href',
      /aikami\.appimage$/,
    );
    await expect(
      page.locator('main a[href="https://aikami.bearlysleeping.com"]').first(),
    ).toBeAttached();
  });
  test('mobile navigation works with the keyboard and closes after following an anchor', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Toggle menu' });
    const menu = page.locator('#mobile-menu');

    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await page.keyboard.press('Enter');
    await menu.getByRole('link', { name: 'Current build' }).click();
    await expect(page).toHaveURL(/#current-build$/);
    await expect(menu).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`strict reflow in ${theme} mode, including a 320px viewport`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/');
      for (const width of [320, 360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
      const audit = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(audit.violations).toEqual([]);
    });
  }
});

test.describe('Editorial homepage without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('essential navigation and section targets remain available', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(navigation).toBeVisible();
    await navigation.getByRole('link', { name: 'Current build' }).click();
    await expect(page).toHaveURL(/#current-build$/);
    await expect(page.locator('#current-build')).toBeInViewport();
    await expect(page.locator('#current-build a[href$="/aikami.appimage"]')).toBeVisible();
    for (const target of ['campaign', 'residents', 'choices', 'download', 'your-ai', 'roadmap']) {
      await expect(page.locator(`#${target}`)).toHaveCount(1);
    }
  });
});
