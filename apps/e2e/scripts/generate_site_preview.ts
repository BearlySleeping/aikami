// apps/e2e/scripts/generate_site_preview.ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { logger } from '$logger';

// Rasterize authored brand artwork with the site's actual installed fonts.
// No gameplay, inference, external font downloads, or OS font assumptions.
const siteDirectory = resolve(import.meta.dir, '../../frontend/site');
const imageDirectory = resolve(siteDirectory, 'public/images');
const fonts = [
  { family: 'Instrument Serif', package: 'instrument-serif', style: 'normal' },
  { family: 'Instrument Serif', package: 'instrument-serif', style: 'italic' },
  { family: 'Inter', package: 'inter', style: 'normal' },
];
const fontStyles = await Promise.all(
  fonts.map(async (font) => {
    const bytes = await readFile(
      resolve(
        siteDirectory,
        `node_modules/@fontsource/${font.package}/files/${font.package}-latin-400-${font.style}.woff2`,
      ),
    );
    return `@font-face { font-family: '${font.family}'; font-style: ${font.style}; font-weight: 400; src: url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2'); }`;
  }),
);
const artwork = await readFile(resolve(imageDirectory, 'campaign-journal.svg'), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(
    `<style>${fontStyles.join('\n')} body { margin: 0; } svg { display: block; }</style>${artwork}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.locator('svg').screenshot({ path: resolve(imageDirectory, 'campaign-journal.png') });
  logger.info('Generated site social preview with installed site fonts.');
} finally {
  await browser.close();
}
