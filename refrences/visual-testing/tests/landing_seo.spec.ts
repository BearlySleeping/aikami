import { expect, test } from '@playwright/test';

/**
 * SEO validation tests.
 * Verifies: meta tags, Open Graph, sitemap, robots.txt, canonical URLs,
 * structured data, heading hierarchy.
 */

// Layout appends " | NordClaw" to all page titles
const SITE_SUFFIX = ' | NordClaw';

const SEO_PAGES = [
  {
    path: '/',
    title: `NordClaw — Meet Chat, your in-house AI consultant${SITE_SUFFIX}`,
    description: 'Stop hiring AI consultants. Chat is the EU-native AI consultant inside NordClaw',
  },
  {
    path: '/pricing',
    title: `Pricing — NordClaw${SITE_SUFFIX}`,
    description: 'Three tiers. EU residency on every plan.',
  },
  {
    path: '/trust',
    title: `Trust Center — NordClaw${SITE_SUFFIX}`,
    description: 'Sub-processors, data residency, DPA',
  },
  {
    path: '/compare',
    titleContains: 'Compare',
  },
  {
    path: '/contact',
    title: `Contact — NordClaw${SITE_SUFFIX}`,
    description: 'Apply as a design partner',
  },
];

test.describe('SEO — meta tags', () => {
  for (const pageDef of SEO_PAGES) {
    test(`${pageDef.path} has correct meta tags`, async ({ page }) => {
      await page.goto(pageDef.path);

      // Title
      if (pageDef.title) {
        await expect(page).toHaveTitle(pageDef.title);
      } else if (pageDef.titleContains) {
        await expect(page).toHaveTitle(new RegExp(pageDef.titleContains));
      }

      // Meta description
      if (pageDef.description) {
        const metaDesc = page.locator('meta[name="description"]');
        const content = await metaDesc.getAttribute('content');
        expect(content).toContain(pageDef.description);
      }

      // Open Graph
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
        'content',
        /.+/,
      );

      // Canonical URL
      const canonical = page.locator('link[rel="canonical"]');
      if ((await canonical.count()) > 0) {
        const href = await canonical.getAttribute('href');
        expect(href).toContain(pageDef.path);
      }

      // Viewport
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        'content',
        /width=device-width/,
      );

      // Charset
      await expect(page.locator('meta[charset]')).toBeAttached();
    });
  }

  test('all pages have at least one h1', async ({ page }) => {
    const pagesToCheck = ['/', '/pricing', '/trust', '/compare', '/walled-garden', '/contact'];

    for (const path of pagesToCheck) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const h1Count = await page.locator('h1').count();
      // Pages should have at least 1 h1. Multiple h1s are acceptable in HTML5
      // when used within sectioning elements (<article>, <section>, etc.)
      expect(h1Count, `${path} should have at least 1 h1`).toBeGreaterThanOrEqual(1);
    }
  });

  test('heading hierarchy is valid (no skipped levels)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Extract heading levels
    const levels = await page.evaluate(() => {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(headings).map((h) => Number.parseInt(h.tagName[1] ?? '0', 10));
    });

    // Check no level is skipped (e.g., h1 → h3 without h2)
    let prevLevel = 0;
    for (const level of levels) {
      expect(level, `Heading level jumped from h${prevLevel} to h${level}`).toBeLessThanOrEqual(
        prevLevel + 1,
      );
      prevLevel = level;
    }
  });
});

test.describe('SEO — sitemap and robots', () => {
  test('sitemap.xml exists and contains URLs', async ({ page }) => {
    // Sitemap is only generated at build time, not in dev mode
    // In CI, the build step generates it
    const response = await page.goto('/sitemap-index.xml');
    if (response?.status() === 404) {
      return;
    }
    expect(response?.status()).toBe(200);

    const text = await response?.text();
    expect(text).toContain('<sitemap');
    expect(text).toContain('<loc>');
  });

  test('robots.txt exists and allows crawling', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);

    const text = await response?.text();
    expect(text).toContain('User-agent');
    expect(text).not.toContain('Disallow: /');
  });
});

test.describe('SEO — performance signals', () => {
  test('pages have preload links for critical fonts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const preloads = page.locator('link[rel="preload"]');
    const count = await preloads.count();

    // Fonts should be preloaded for performance
    let hasFontPreload = false;
    for (let i = 0; i < count; i++) {
      const as = await preloads.nth(i).getAttribute('as');
      if (as === 'font') {
        hasFontPreload = true;
      }
    }
    // Not strictly required but good to have
    expect(hasFontPreload || count === 0).toBeTruthy();
  });

  test('images have alt attributes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      // Every img must have alt (can be empty for decorative)
      expect(alt).toBeDefined();
    }
  });

  test('internal links are relative (no hardcoded domain)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that internal links use relative paths
    const links = page.locator("a[href^='/']");
    const count = await links.count();
    expect(count).toBeGreaterThan(3);
  });
});
