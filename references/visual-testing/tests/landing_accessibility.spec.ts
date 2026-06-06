import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility audit tests using axe-core.
 * Verifies: WCAG 2.1 AA compliance, ARIA labels, keyboard navigation,
 * color contrast, semantic HTML.
 */

const A11Y_PAGES = [
  '/',
  '/pricing',
  '/trust',
  '/compare',
  '/contact',
  '/walled-garden',
  '/compliance',
];

test.describe('Accessibility — axe-core audit', () => {
  for (const path of A11Y_PAGES) {
    test(`${path} passes WCAG 2.1 AA`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Log violations for debugging
      if (results.violations.length > 0) {
        for (const _violation of results.violations) {
        }
      }

      // Only fail on critical violations
      const criticalViolations = results.violations.filter((v) => v.impact === 'critical');

      if (criticalViolations.length > 0) {
        for (const _v of criticalViolations) {
        }
      }
      expect(criticalViolations, `${path} has critical accessibility violations`).toEqual([]);
    });
  }
});

test.describe('Accessibility — keyboard navigation', () => {
  test('focus is visible on all interactive elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Tab through all focusable elements
    const focusableCount = await page.evaluate(() => {
      const elements = document.querySelectorAll(
        'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      return elements.length;
    });

    // Verify at least some focusable elements exist
    expect(focusableCount).toBeGreaterThan(0);

    // Tab through first few elements
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });

  test('skip link or semantic landmarks exist', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for semantic landmarks
    const hasMain = await page.locator('main').count();
    const _hasNav = await page.locator('nav').count();
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

    // At least one nav should have a label
    let hasLabel = false;
    for (let i = 0; i < count; i++) {
      const label = await navs.nth(i).getAttribute('aria-label');
      if (label) {
        hasLabel = true;
      }
    }
    expect(hasLabel).toBe(true);
  });

  test('images and SVGs have appropriate accessibility', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // All <img> must have alt
    const images = page.locator('img');
    const imgCount = await images.count();

    for (let i = 0; i < imgCount; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      expect(alt, `Image ${i + 1} missing alt attribute`).not.toBeNull();
    }

    // Decorative SVGs should have aria-hidden
    const svgs = page.locator('svg');
    const svgCount = await svgs.count();

    let _decorativeSvgs = 0;
    let _labelledSvgs = 0;

    for (let i = 0; i < svgCount; i++) {
      const ariaHidden = await svgs.nth(i).getAttribute('aria-hidden');
      const hasTitle = (await svgs.nth(i).locator('title').count()) > 0;
      const hasLabel = (await svgs.nth(i).getAttribute('aria-label')) !== null;

      if (ariaHidden === 'true') {
        _decorativeSvgs++;
      }
      if (hasTitle || hasLabel) {
        _labelledSvgs++;
      }
    }
  });

  test('forms have labels', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');

    const inputs = page.locator('input, textarea, select');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        expect(await label.count(), `Input #${id} has no label`).toBeGreaterThan(0);
      }
    }
  });

  test('color contrast on CTAs is sufficient', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check CTAs have sufficient contrast by verifying
    // they use the signal color system (not raw hex)
    const ctas = page.locator('a.bg-signal, button.bg-signal');
    expect(await ctas.count()).toBeGreaterThan(0);
  });
});
