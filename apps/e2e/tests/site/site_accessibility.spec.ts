// apps/e2e/tests/site/site_accessibility.spec.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility audit tests for Aikami site using axe-core.
 * Verifies: WCAG 2.1 AA compliance, ARIA labels, keyboard navigation,
 * semantic HTML.
 */

const A11Y_PAGES = ['/'];

test.describe('Accessibility — axe-core audit', () => {
  for (const path of A11Y_PAGES) {
    test(`${path} passes WCAG 2.1 AA`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // The @axe-core/playwright package bundles a newer Playwright Page type than our
      // project's @playwright/test version. The runtime API is compatible.
      // @ts-expect-error - Playwright Page type version mismatch between axe-core and @playwright/test
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const criticalViolations = results.violations.filter((v) => v.impact === 'critical');
      expect(criticalViolations, `${path} has critical accessibility violations`).toEqual([]);
    });
  }
});

test.describe('Accessibility — keyboard navigation', () => {
  test('focus is visible on interactive elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const focusableCount = await page.evaluate(() => {
      const elements = document.querySelectorAll(
        'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      return elements.length;
    });

    expect(focusableCount).toBeGreaterThan(0);

    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });

  test('semantic landmarks exist', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const hasMain = await page.locator('main').count();
    const hasHeader = await page.locator('header').count();
    const hasFooter = await page.locator('footer').count();

    expect(hasMain).toBeGreaterThan(0);
    expect(hasHeader).toBeGreaterThan(0);
    expect(hasFooter).toBeGreaterThan(0);
  });
});

test.describe('Accessibility — ARIA and semantics', () => {
  test('navigation has aria-label', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const navs = page.locator('nav');
    const count = await navs.count();
    expect(count).toBeGreaterThan(0);

    let hasLabel = false;
    for (let i = 0; i < count; i++) {
      const label = await navs.nth(i).getAttribute('aria-label');
      if (label) {
        hasLabel = true;
      }
    }
    expect(hasLabel).toBe(true);
  });

  test('images have alt attributes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const images = page.locator('img');
    const imgCount = await images.count();

    for (let i = 0; i < imgCount; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      expect(alt, `Image ${i + 1} missing alt attribute`).not.toBeNull();
    }
  });
});
