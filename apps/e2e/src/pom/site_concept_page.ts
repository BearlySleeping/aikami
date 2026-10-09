// apps/e2e/src/pom/site_concept_page.ts
import type { Locator, Page } from '@playwright/test';

/** Homepage concept gallery selectors, shared by desktop and mobile checks. */
export class SiteConceptPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Navigate to the gallery without relying on client-side JavaScript. */
  async goto(): Promise<void> {
    await this.page.goto('/#concepts');
  }

  /** The labelled concept gallery region. */
  get gallery(): Locator {
    return this.page.getByRole('region', { name: 'A glimpse of the adventure.' });
  }

  /** Explicit disclaimer separating visual direction from current capabilities. */
  get disclaimer(): Locator {
    return this.gallery.getByText('Design concepts, not screenshots of the current build.', {
      exact: false,
    });
  }

  /** Preview buttons open a modal without navigating away. */
  get previewButtons(): Locator {
    return this.gallery.getByRole('button', { name: /^Open full-size concept:/ });
  }

  /** Slides in their document order. */
  get slides(): Locator {
    return this.gallery.locator('[data-carousel-slide]');
  }

  /** Currently visible slide, or all slides when JavaScript is disabled. */
  get activeSlide(): Locator {
    return this.gallery.locator('[data-carousel-slide]:not([hidden])');
  }

  /** Preview button in the active slide. */
  get activePreviewButton(): Locator {
    return this.activeSlide.getByRole('button', { name: /^Open full-size concept:/ });
  }

  /** Advance the carousel by one slide. */
  get nextButton(): Locator {
    return this.gallery.getByRole('button', { name: 'Next concept', exact: true });
  }

  /** Move the carousel back by one slide. */
  get previousButton(): Locator {
    return this.gallery.getByRole('button', { name: 'Previous concept', exact: true });
  }

  /** Navigation dots select a specific slide. */
  get slideButtons(): Locator {
    return this.gallery.locator('[data-carousel-index]');
  }

  /** Live announcement identifies the active slide. */
  get slideStatus(): Locator {
    return this.gallery.locator('[data-carousel-status]');
  }

  /** Only the active native dialog is exposed to accessibility APIs. */
  get overlay(): Locator {
    return this.page.getByRole('dialog');
  }

  /** Full-resolution image in the currently open overlay. */
  get overlayImage(): Locator {
    return this.overlay.getByRole('img');
  }

  /** Top-right close icon is keyboard-accessible. */
  get closeButton(): Locator {
    return this.overlay.getByRole('button', { name: 'Close full-size preview', exact: true });
  }

  /** Dismiss the overlay by clicking the empty area, outside its image. */
  async clickOutside(): Promise<void> {
    await this.overlay
      .getByRole('button', { name: 'Dismiss image preview', exact: true })
      .click({ position: { x: 8, y: 8 } });
  }

  /** Responsive image elements emitted by the shared Picture component. */
  get images(): Locator {
    return this.gallery.getByRole('img');
  }

  /** Hover/focus caption shown within a slide preview. */
  get hoverCaption(): Locator {
    return this.activePreviewButton.locator('span.absolute');
  }
}
