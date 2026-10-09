// apps/e2e/tests/site/site_concept_overlay.spec.ts
import { expect, test } from '@playwright/test';
import { SiteConceptPage } from '$pom';

test.describe('Concept image overlay', () => {
  test('opens every full-size image without changing the URL and closes with the icon', async ({
    page,
  }) => {
    const concepts = new SiteConceptPage(page);
    await concepts.goto();
    const originalUrl = page.url();

    for (let index = 0; index < 6; index++) {
      const trigger = concepts.activePreviewButton;
      const fullSizeSource = await trigger.getAttribute('data-full-size-src');
      await trigger.click();
      await expect(concepts.overlay).toBeVisible();
      await expect
        .poll(() => concepts.overlay.evaluate((dialog) => dialog.matches(':modal')))
        .toBe(true);
      await expect(concepts.closeButton).toBeFocused();
      await expect(page).toHaveURL(originalUrl);
      await expect(concepts.overlayImage).toHaveAttribute('src', fullSizeSource ?? '');
      await expect
        .poll(() =>
          concepts.overlayImage.evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth === 1672 && image.naturalHeight === 941,
          ),
        )
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.overflow))
        .toBe('hidden');

      // Clicking the image must not be mistaken for a click outside it.
      await concepts.overlayImage.click();
      await expect(concepts.overlay).toBeVisible();

      const bounds = await concepts.overlayImage.boundingBox();
      const viewport = page.viewportSize();
      expect(bounds).not.toBeNull();
      expect(viewport).not.toBeNull();
      if (!bounds || !viewport) {
        throw new Error('Overlay sizing requires image and viewport bounds.');
      }
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);

      await concepts.closeButton.click();
      await expect(concepts.overlay).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page).toHaveURL(originalUrl);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.overflow))
        .toBe('');
      await concepts.nextButton.click();
    }
  });

  test('navigates slides and reveals captions on hover and keyboard focus', async ({ page }) => {
    const concepts = new SiteConceptPage(page);
    await concepts.goto();

    await expect(concepts.activeSlide).toHaveAttribute(
      'aria-label',
      /1 of 6: Dialogue in the world/,
    );
    await expect(concepts.slideButtons).toHaveCount(6);
    await expect(concepts.slideStatus).toHaveText('Slide 1 of 6: Dialogue in the world');
    const supportsHover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    if (supportsHover) {
      await expect(concepts.hoverCaption).toHaveCSS('opacity', '0');
    } else {
      await expect(concepts.hoverCaption).toHaveCSS('opacity', '1');
    }
    await concepts.activePreviewButton.hover();
    await expect(concepts.hoverCaption).toHaveCSS('opacity', '1');
    await expect(concepts.hoverCaption).toContainText('Dialogue in the world');
    await expect(concepts.hoverCaption).toContainText('Meet people where they live.');

    await concepts.nextButton.click();
    await expect(concepts.activeSlide).toHaveAttribute('aria-label', /2 of 6: Create a campaign/);
    await concepts.previousButton.click();
    await expect(concepts.activeSlide).toHaveAttribute(
      'aria-label',
      /1 of 6: Dialogue in the world/,
    );

    await concepts.slideButtons.nth(5).click();
    await expect(concepts.activeSlide).toHaveAttribute(
      'aria-label',
      /6 of 6: Change the battlefield/,
    );
    await expect(concepts.slideStatus).toHaveText('Slide 6 of 6: Change the battlefield');
    await page.keyboard.press('ArrowRight');
    await expect(concepts.activeSlide).toHaveAttribute(
      'aria-label',
      /1 of 6: Dialogue in the world/,
    );
    await page.keyboard.press('ArrowLeft');
    await expect(concepts.activeSlide).toHaveAttribute(
      'aria-label',
      /6 of 6: Change the battlefield/,
    );
  });

  test('dismisses with Escape and outside clicks, returning focus to the preview', async ({
    page,
  }) => {
    const concepts = new SiteConceptPage(page);
    await concepts.goto();
    const originalUrl = page.url();
    const trigger = concepts.activePreviewButton;

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(concepts.overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(concepts.overlay).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(originalUrl);

    await trigger.click();
    await expect(concepts.overlay).toBeVisible();
    await concepts.clickOutside();
    await expect(concepts.overlay).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(originalUrl);
  });
});
