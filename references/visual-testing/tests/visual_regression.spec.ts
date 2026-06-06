import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Visual regression test spec.
 * Captures full-page screenshots of our landing pages for comparison
 * against the reference design from nordclaw.lovable.app.
 *
 * Screenshots saved to test-results/visual-regression/<page>-<device>-actual.png
 */

const PAGES = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/trust', name: 'trust' },
  { path: '/compare', name: 'compare' },
  { path: '/contact', name: 'contact' },
  { path: '/compliance', name: 'compliance' },
  { path: '/walled-garden', name: 'walled-garden' },
  { path: '/personas', name: 'personas' },
  { path: '/investors', name: 'investors' },
  { path: '/manifest', name: 'manifest' },
  { path: '/eu-ai-act', name: 'eu-ai-act' },
  { path: '/use-cases', name: 'use-cases' },
];

const OUTPUT_DIR = path.join(process.cwd(), 'test-results', 'visual-regression');

async function hideDevToolbar(page: Parameters<Parameters<typeof test>[1]>[0]) {
  await page.evaluate(() => {
    document.querySelector('astro-dev-toolbar')?.remove();
  });
}

test.describe('Visual Regression — full page screenshots', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  for (const pageDef of PAGES) {
    test(`${pageDef.name} — desktop screenshot`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(pageDef.path, { waitUntil: 'networkidle' });
      await hideDevToolbar(page);
      await page.waitForTimeout(1000);

      const dir = path.join(OUTPUT_DIR, pageDef.name);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, 'desktop-actual.png'),
        fullPage: true,
      });
    });

    test(`${pageDef.name} — mobile screenshot`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(pageDef.path, { waitUntil: 'networkidle' });
      await hideDevToolbar(page);
      await page.waitForTimeout(1000);

      const dir = path.join(OUTPUT_DIR, pageDef.name);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, 'mobile-actual.png'),
        fullPage: true,
      });
    });
  }
});

test.describe('Visual Regression — chat widget states', () => {
  test('chat initial state screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await hideDevToolbar(page);
    await page.waitForTimeout(1000);

    const chat = page.locator('#chat-chat');
    await expect(chat).toBeVisible();

    const dir = path.join(OUTPUT_DIR, 'chat');
    mkdirSync(dir, { recursive: true });
    await chat.screenshot({
      path: path.join(dir, 'initial-state-actual.png'),
    });
  });
});
