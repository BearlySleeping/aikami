// apps/e2e/tests/site/site_concepts.spec.ts
import { expect, test } from '@playwright/test';
import { SiteConceptPage } from '$pom';

test.describe('Homepage concept previews', () => {
  test.use({ javaScriptEnabled: false });

  test('labels concepts honestly and serves six responsive, full-size previews', async ({
    page,
    request,
  }) => {
    const concepts = new SiteConceptPage(page);
    await concepts.goto();

    await expect(concepts.gallery).toBeVisible();
    await expect(concepts.disclaimer).toBeVisible();
    await expect(concepts.images).toHaveCount(6);
    await expect(concepts.previewButtons).toHaveCount(6);
    await expect(concepts.slides).toHaveCount(6);
    await expect(concepts.activeSlide).toHaveCount(6);

    const titles = [
      'Dialogue in the world',
      'Create a campaign',
      'Shape your character',
      'Know your hero',
      'Plan your next move',
      'Change the battlefield',
    ];
    for (const [index, title] of titles.entries()) {
      await expect(concepts.slides.nth(index)).toHaveAttribute(
        'aria-label',
        new RegExp(`: ${title}$`),
      );
      await expect(concepts.previewButtons.nth(index)).toHaveAccessibleName(
        `Open full-size concept: ${title}`,
      );
    }

    for (let index = 0; index < 6; index++) {
      const image = concepts.images.nth(index);
      // Browsers load lazy images eagerly with JavaScript disabled; no scripted scroll needed.
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('alt', /.+/);
      await expect(image).toHaveAttribute('width', '1672');
      await expect(image).toHaveAttribute('height', '941');
      await expect(image).toHaveAttribute('loading', 'lazy');
      await expect(image).toHaveAttribute('srcset', /480w.*832w.*1200w.*1672w/);

      // DOM visibility alone is insufficient: broken images can still be visible.
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);

      const href = await concepts.previewButtons.nth(index).getAttribute('data-full-size-src');
      expect(href).toMatch(/\.webp$/);
      if (!href) {
        throw new Error('Concept preview is missing its full-size source.');
      }
      const response = await request.get(href);
      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toContain('image/webp');
    }

    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error('Responsive concept check requires a viewport.');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
});
