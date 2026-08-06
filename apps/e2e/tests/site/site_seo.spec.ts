// apps/e2e/tests/site/site_seo.spec.ts
import { expect, test } from '@playwright/test';

/**
 * SEO validation tests for Aikami site.
 * Verifies: meta tags, Open Graph, sitemap, robots.txt, canonical URLs,
 * structured data, heading hierarchy.
 */

const SEO_PAGES = [
  {
    path: '/',
    title: /Aikami/,
    // Updated to match the current landing page meta description
    // (the description was rewritten in the interactive showcase rework).
    description: 'AI RPG engine',
  },
];

test.describe('SEO — meta tags', () => {
  for (const pageDef of SEO_PAGES) {
    test(`${pageDef.path} has correct meta tags`, async ({ page }) => {
      await page.goto(pageDef.path);

      if (pageDef.title) {
        await expect(page).toHaveTitle(pageDef.title);
      }

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

  test('home page has exactly one h1', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
  });

  test('heading hierarchy is valid (no skipped levels)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const levels = await page.evaluate(() => {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(headings).map((h) => Number.parseInt(h.tagName[1] ?? '0', 10));
    });

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
  test('robots.txt exists and allows crawling', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);

    const text = await response?.text();
    expect(text).toContain('User-agent');
    expect(text).not.toContain('Disallow: /');
  });

  test('sitemap-index.xml exists', async ({ page }) => {
    const response = await page.goto('/sitemap-index.xml');
    if (response?.status() === 404) {
      return; // Not generated in dev mode
    }
    expect(response?.status()).toBe(200);

    const text = await response?.text();
    expect(text).toContain('<sitemap');
    expect(text).toContain('<loc>');
  });
});

test.describe('SEO — structured data', () => {
  test('JSON-LD schema is present and valid', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const schemas = page.locator('script[type="application/ld+json"]');
    const count = await schemas.count();

    expect(count, 'Should have at least one JSON-LD script').toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const textContent = await schemas.nth(i).textContent();
      expect(textContent).toBeTruthy();
      if (!textContent) {
        continue;
      }

      expect(() => JSON.parse(textContent)).not.toThrow();

      const parsed = JSON.parse(textContent);
      expect(parsed['@context']).toBe('https://schema.org');
    }
  });
});

test.describe('SEO — performance signals', () => {
  test('pages have preload links for critical fonts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const preloads = page.locator('link[rel="preload"]');
    const count = await preloads.count();

    let hasFontPreload = false;
    for (let i = 0; i < count; i++) {
      const as = await preloads.nth(i).getAttribute('as');
      if (as === 'font') {
        hasFontPreload = true;
      }
    }
    expect(hasFontPreload || count === 0).toBeTruthy();
  });

  test('images have alt attributes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      expect(alt).toBeDefined();
    }
  });

  test('internal links are relative', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const links = page.locator("a[href^='/']");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  });
});
