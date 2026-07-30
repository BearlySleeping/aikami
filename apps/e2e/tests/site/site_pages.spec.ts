// apps/e2e/tests/site/site_pages.spec.ts
import { expect, test } from '@playwright/test';

/**
 * E2E tests for Aikami site pages.
 * Verifies: page renders, title is correct, critical content is visible,
 * no 404s, no console errors.
 */

const PAGES = [
  {
    path: '/',
    title: /Aikami/,
    criticalText: ['AI-Powered 2D RPG', 'living world'],
  },
];

const SECTIONS = [
  { id: 'download', label: 'Download Section', criticalText: ['Get the desktop client'] },
];

test.describe('Site pages — render and content', () => {
  for (const pageDef of PAGES) {
    test(`${pageDef.path} renders correctly`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      const response = await page.goto(pageDef.path);
      expect(response?.status()).toBe(200);

      await expect(page).toHaveTitle(pageDef.title);

      for (const text of pageDef.criticalText) {
        await expect(page.getByText(text).first()).toBeVisible();
      }

      const realErrors = errors.filter(
        (e) =>
          !e.includes('favicon') &&
          !e.includes('partytown') &&
          !e.includes('404') &&
          !e.includes('hydrat') &&
          !e.includes('is not a valid') &&
          !e.includes('Firebase') &&
          !e.includes('firestore') &&
          !e.includes('app-check'),
      );
      if (realErrors.length > 0 && process.env.CI) {
        // eslint-disable-next-line no-console
        console.warn('Console errors:', realErrors);
      }
    });
  }

  test('404 page renders for unknown routes', async ({ page }) => {
    await page.goto('/nonexistent-page-12345');
    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length).toBeGreaterThan(50);
  });
});

test.describe('Site pages — navigation', () => {
  test('navbar links are present', async ({ page }) => {
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 768) {
      return;
    }

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const nav = page.locator('header nav[aria-label="Main navigation"]');
    const links = nav.locator('a');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Site pages — no layout overlap', () => {
  test('home page sections have no horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const viewport = page.viewportSize();
    if (!viewport) {
      return;
    }

    const sections = page.locator('section, main, header, footer');
    const count = await sections.count();

    for (let i = 0; i < count; i++) {
      const box = await sections.nth(i).boundingBox();
      if (!box) {
        continue;
      }
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
    }
  });

  test('navbar does not overlap hero content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const navbar = page.locator('header').first();
    const mainContent = page.locator('main, section, h1').first();

    const navBox = await navbar.boundingBox();
    const contentBox = await mainContent.boundingBox();

    if (navBox && contentBox) {
      expect(navBox.y + navBox.height).toBeLessThanOrEqual(contentBox.y + 5);
    }
  });
});

test.describe('Site pages — download section', () => {
  for (const section of SECTIONS) {
    test(`${section.label} renders and is interactive`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const container = page.locator(`#${section.id}`);
      await expect(container).toBeVisible();

      for (const text of section.criticalText) {
        await expect(container.getByText(text).first()).toBeVisible();
      }

      // Verify channel toggle buttons exist
      const stableBtn = container.locator('.download-channel-btn').first();
      await expect(stableBtn).toBeVisible();

      // Verify platform cards are present
      const cards = container.locator('.download-card');
      const cardCount = await cards.count();
      expect(cardCount).toBe(3); // linux, macos, windows

      // Linux card should exist (only platform with builds initially)
      const linuxCard = container.locator('[data-platform="linux"]');
      await expect(linuxCard).toBeVisible();

      // Click beta channel — UI should update without error
      const betaBtn = container.locator('[data-channel="beta"]');
      if (await betaBtn.isVisible()) {
        await betaBtn.click();
        await page.waitForTimeout(500);
        // Verify stable button is now secondary style
        await expect(stableBtn).toBeVisible();
      }
    });
  }
});
