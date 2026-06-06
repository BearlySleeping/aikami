/** biome-ignore-all lint/suspicious/noConsole: Playwright test scripts use console for output */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

/**
 * Captures reference screenshots from the live Lovable reference site.
 * Saves to refrences/pages/<page>/{desktop,mobile}/screen.png
 *
 * Usage: bun run scripts/capture_reference_screenshots.ts
 */

const BASE_URL = 'https://nordclaw.lovable.app';
const OUTPUT_DIR = join(import.meta.dirname, '..', 'refrences', 'pages');

const PAGES = [
  { path: '/', name: 'home' },
  { path: '/compare', name: 'compare' },
  { path: '/compliance', name: 'compliance' },
  { path: '/contact', name: 'contact' },
  { path: '/eu-ai-act', name: 'eu-ai-act' },
  { path: '/investors', name: 'investors' },
  { path: '/manifest', name: 'manifest' },
  { path: '/personas', name: 'personas' },
  { path: '/pricing', name: 'pricing' },
  { path: '/trust', name: 'trust' },
  { path: '/use-cases', name: 'use-cases' },
  { path: '/walled-garden', name: 'walled-garden' },
];

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 375, height: 812 },
} as const;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  for (const pageDef of PAGES) {
    for (const [device, viewport] of Object.entries(VIEWPORTS)) {
      const dir = join(OUTPUT_DIR, pageDef.name);
      const filePath = join(dir, device, 'screen.png');

      if (existsSync(filePath)) {
        continue;
      }

      mkdirSync(join(dir, device), { recursive: true });

      const page = await context.newPage();
      await page.setViewportSize(viewport);

      try {
        await page.goto(`${BASE_URL}${pageDef.path}`, {
          waitUntil: 'networkidle',
          timeout: 15000,
        });

        // Remove Lovable toolbar if present
        await page.evaluate(() => {
          document.querySelector('[class*="lovable"]')?.remove();
          document.querySelector('[id*="lovable"]')?.remove();
          document.querySelector('astro-dev-toolbar')?.remove();
        });

        // Wait for fonts and animations to settle
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: filePath,
          fullPage: true,
        });
      } catch (_err) {
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
}

main().catch(console.error);
