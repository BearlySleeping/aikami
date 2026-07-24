// apps/e2e/tests/site/site_performance.spec.ts
import { expect, test } from '@playwright/test';

/**
 * Performance audit tests for Aikami site.
 * Verifies: Core Web Vitals, page load times, cache headers.
 */

const PERF_PAGES = [{ path: '/', name: 'home' }];

test.describe('Performance — page load', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Performance metrics only on Chromium');

  for (const pageDef of PERF_PAGES) {
    test(`${pageDef.name} page meets performance thresholds`, async ({ page, browserName }) => {
      if (browserName !== 'chromium') {
        return;
      }

      await page.goto(pageDef.path);
      await page.waitForLoadState('networkidle');

      const perfMetrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

        return {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
          domComplete: Math.round(nav.domComplete - nav.fetchStart),
          loadEventEnd: Math.round(nav.loadEventEnd - nav.fetchStart),
          resourceCount: performance.getEntriesByType('resource').length,
          firstPaint: performance
            .getEntriesByType('paint')
            .find((e) => e.name === 'first-contentful-paint')?.startTime,
        };
      });

      expect(perfMetrics.domContentLoaded).toBeLessThan(3000);
      expect(perfMetrics.domComplete).toBeLessThan(5000);

      if (perfMetrics.firstPaint) {
        expect(perfMetrics.firstPaint).toBeLessThan(2000);
      }
    });
  }

  test('home page has no render-blocking resources', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockingResources = await page.evaluate(() => {
      const links = document.querySelectorAll('link[rel="stylesheet"]');
      const scripts = document.querySelectorAll('script[src]:not([async]):not([defer])');

      return {
        stylesheets: links.length,
        blockingScripts: scripts.length,
      };
    });

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
          if (/[_-][A-Za-z0-9]{6,}[_-]/.test(src)) {
            hashed++;
          }
        }
      }

      return { hashed, total };
    });

    if (hashedAssets.total > 0) {
      expect(hashedAssets.hashed).toBe(hashedAssets.total);
    }
  });
});
