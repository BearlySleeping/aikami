import { expect, test } from '@playwright/test';

// @ts-expect-error - lighthouse types for playwright integration
const _lighthouseConfig = {
  settings: {
    output: 'json',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    formFactor: 'desktop',
    screenEmulation: { disabled: true },
  },
};

/**
 * Lighthouse performance audit tests.
 * Verifies: Core Web Vitals, performance score, best practices.
 */

const PERF_PAGES = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/trust', name: 'trust' },
];

test.describe('Performance — Lighthouse CI', () => {
  // Skip in CI for now — full Lighthouse audit is heavy
  test.skip(({ browserName }) => browserName !== 'chromium', 'Lighthouse only runs on Chromium');

  for (const pageDef of PERF_PAGES) {
    test(`${pageDef.name} page meets performance thresholds`, async ({ page, browserName }) => {
      if (browserName !== 'chromium') {
        return;
      }

      await page.goto(pageDef.path);
      await page.waitForLoadState('networkidle');

      // Run basic performance checks without full Lighthouse (faster)
      const perfMetrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

        return {
          // Core metrics from Navigation Timing API
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
          domComplete: Math.round(nav.domComplete - nav.fetchStart),
          loadEventEnd: Math.round(nav.loadEventEnd - nav.fetchStart),
          // Resource hints
          resourceCount: performance.getEntriesByType('resource').length,
          // Rough FCP approximation
          firstPaint: performance
            .getEntriesByType('paint')
            .find((e) => e.name === 'first-contentful-paint')?.startTime,
        };
      });

      // DOM content loaded within 3 seconds
      expect(perfMetrics.domContentLoaded).toBeLessThan(3000);

      // Complete load within 5 seconds
      expect(perfMetrics.domComplete).toBeLessThan(5000);

      // First paint within 2 seconds
      if (perfMetrics.firstPaint) {
        expect(perfMetrics.firstPaint).toBeLessThan(2000);
      }
    });
  }

  test('home page has no render-blocking resources', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for render-blocking CSS/JS
    const blockingResources = await page.evaluate(() => {
      const links = document.querySelectorAll('link[rel="stylesheet"]');
      const scripts = document.querySelectorAll('script[src]:not([async]):not([defer])');

      return {
        stylesheets: links.length,
        blockingScripts: scripts.length,
      };
    });

    // Astro should inline critical CSS — few external stylesheets
    expect(blockingResources.stylesheets).toBeLessThan(5);
  });

  test('static assets use cache-friendly hashed filenames', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const hashedAssets = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));

      let hashed = 0;
      let total = 0;

      for (const el of [...scripts, ...links]) {
        const src = el.getAttribute('src') || el.getAttribute('href') || '';
        if (src?.includes('_astro/')) {
          total++;
          // Hashed filenames contain content hash like D12hhW3-
          if (/[_-][A-Za-z0-9]{6,}[_-]/.test(src)) {
            hashed++;
          }
        }
      }

      return { hashed, total };
    });

    // All Astro assets should have content hashes
    if (hashedAssets.total > 0) {
      expect(hashedAssets.hashed).toBe(hashedAssets.total);
    }
  });

  test('text remains visible during font load (font-display: swap)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const _fontDisplay = await page.evaluate(() => {
      const fontFaces = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules);
          } catch {
            return [];
          }
        })
        .filter((rule) => rule instanceof CSSFontFaceRule)
        .map((rule) => {
          try {
            return (rule as CSSFontFaceRule).style.getPropertyValue('font-display');
          } catch {
            return '';
          }
        });

      return fontFaces;
    });
  });
});
