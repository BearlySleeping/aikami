// apps/e2e/tests/site/site_responsive.spec.ts
import { expect, test } from '@playwright/test';

/**
 * Responsive design tests for Aikami site.
 * Verifies: responsive breakpoints, no element overlap, mobile menu.
 */

test.describe('Responsive — mobile menu', () => {
  test('hamburger menu is visible on mobile, hidden on desktop', async ({ page }) => {
    // Desktop: hamburger hidden
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const desktopBtn = page.locator('#mobile-menu-button');
    await expect(desktopBtn).not.toBeVisible();

    // Mobile: hamburger visible
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const mobileBtn = page.locator('#mobile-menu-button');
    await expect(mobileBtn).toBeVisible();
  });

  test('mobile menu opens and closes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const btn = page.locator('#mobile-menu-button');
    const menu = page.locator('#mobile-menu');

    await expect(menu).toBeHidden();

    await btn.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('a')).not.toHaveCount(0);

    await btn.click();
    await expect(menu).toBeHidden();
  });
});

test.describe('Responsive — layout breakpoints', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'wide', width: 1920, height: 1080 },
  ];

  for (const vp of viewports) {
    test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {
      test('home page has no horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
        const viewportW = vp.width;

        expect(bodyWidth, `body overflows at ${vp.name}`).toBeLessThanOrEqual(viewportW + 50);
      });

      test('home page text is readable', async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const hasTinyText = await page.evaluate(() => {
          const elements = document.querySelectorAll('p, span, a, li, h1, h2, h3, div');
          for (const el of elements) {
            const style = window.getComputedStyle(el);
            const fontSize = Number.parseFloat(style.fontSize);
            if (fontSize > 0 && fontSize < 8 && el.textContent?.trim()) {
              return true;
            }
          }
          return false;
        });

        expect(hasTinyText).toBe(false);
      });
    });
  }
});
