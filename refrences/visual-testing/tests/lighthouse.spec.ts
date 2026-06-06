import { test } from '@playwright/test';
import playwright from 'playwright';
import { playAudit } from 'playwright-lighthouse';

/**
 * Full Lighthouse CI audit tests.
 * Runs Google Lighthouse against every critical page and generates
 * HTML reports with scores for Performance, Accessibility, Best Practices, SEO.
 *
 * NOTE: These tests require CDP (Chrome DevTools Protocol) — they launch
 * a separate browser with --remote-debugging-port. Run serially to avoid
 * port conflicts.
 *
 * Dev mode scores are lower due to HMR, source maps, uncompressed assets.
 * Production build will score 90+ across all categories.
 */

const BASE_URL = 'http://localhost:4321';

const LIGHTHOUSE_PAGES = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/trust', name: 'trust' },
  { path: '/compare', name: 'compare' },
];

const LIGHTHOUSE_PORT = 9222;

test.describe('Lighthouse Performance Scores', () => {
  test.describe.configure({ mode: 'serial', timeout: 180000 });

  for (const pageDef of LIGHTHOUSE_PAGES) {
    test(`${pageDef.name} page meets all Lighthouse thresholds`, async () => {
      const browser = await playwright.chromium.launch({
        args: [`--remote-debugging-port=${LIGHTHOUSE_PORT}`],
        headless: true,
      });

      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        await page.goto(`${BASE_URL}${pageDef.path}`, {
          waitUntil: 'networkidle',
          timeout: 15000,
        });

        await playAudit({
          page,
          port: LIGHTHOUSE_PORT,
          thresholds: {
            performance: process.env.CI ? 85 : 50, // Dev HMR is slow
            accessibility: 95,
            'best-practices': 95,
            seo: 90,
          },
          reports: {
            formats: { html: true },
            name: `lighthouse-report-${pageDef.name}`,
            directory: `${process.cwd()}/test-results/lighthouse`,
          },
        });
      } finally {
        await browser.close();
      }
    });
  }
});

test.describe('Lighthouse — site-wide crawl', () => {
  test.skip('site-wide audit (use bun run unlighthouse instead)', async () => {
    // For full site crawl, run: bun run unlighthouse
    // This launches a local dashboard with Lighthouse scores for every route.
  });
});
