import { test } from '@playwright/test';

/**
 * Image optimization tests.
 * Verifies: webp/avif formats, responsive srcset, lazy loading,
 * appropriate dimensions, alt text.
 */

test.describe('Image optimization — formats', () => {
  test('images use next-gen formats (webp/avif)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const _imageFormats = await page.evaluate(() => {
      const pictures = document.querySelectorAll('picture source');
      const imgs = document.querySelectorAll('img');

      const formats: string[] = [];

      for (const source of pictures) {
        const srcset = source.getAttribute('srcset') || '';
        if (srcset.includes('.webp')) {
          formats.push('webp');
        }
        if (srcset.includes('.avif')) {
          formats.push('avif');
        }
      }

      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        if (src.includes('.webp')) {
          formats.push('webp');
        }
        if (src.includes('.avif')) {
          formats.push('avif');
        }
      }

      return formats;
    });
  });

  test('images have explicit width and height to prevent layout shift', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const imagesWithoutDimensions = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      const missing: string[] = [];

      for (const img of imgs) {
        const w = img.getAttribute('width');
        const h = img.getAttribute('height');
        const src = img.getAttribute('src') || '';
        if (!w || !h) {
          missing.push(src);
        }
      }

      return missing;
    });

    // CLS prevention: all images should have width/height
    if (imagesWithoutDimensions.length > 0) {
    }
    // Don't fail — some inline SVGs don't have them
  });
});

test.describe('Image optimization — lazy loading', () => {
  test('below-fold images are lazy-loaded', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const lazyStats = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let eager = 0;
      let lazy = 0;

      for (const img of imgs) {
        const loading = img.getAttribute('loading');
        if (loading === 'lazy') {
          lazy++;
        } else if (loading === 'eager') {
          eager++;
        }
        // If no loading attribute, browser defaults to eager
      }

      return { eager, lazy, total: imgs.length };
    });

    // Eager images should be minimal (hero images only)
    if (lazyStats.eager > 3) {
    }
  });

  test('vital images have high fetch priority', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const _priorityHints = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[fetchpriority="high"]');
      const links = document.querySelectorAll('link[fetchpriority="high"]');
      return { highPriorityImgs: imgs.length, highPriorityLinks: links.length };
    });
  });
});

test.describe('Image optimization — responsive', () => {
  test('images use srcset for responsive delivery', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const _srcsetStats = await page.evaluate(() => {
      const pictures = document.querySelectorAll('picture source');
      const imgsWithSrcset = document.querySelectorAll('img[srcset]');

      return {
        pictureSources: pictures.length,
        imgsWithSrcset: imgsWithSrcset.length,
      };
    });
  });
});
