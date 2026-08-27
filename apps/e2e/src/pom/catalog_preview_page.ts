// apps/e2e/src/pom/catalog_preview_page.ts
//
// Page object model for the catalog asset preview island (C-446).
// Exposes stable selectors for the preview island, thumbnail, error notice,
// and tileset grid toggle.

import type { Page, Locator } from '@playwright/test';

export class CatalogPreviewPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The preview island container (mounts the dynamic preview component). */
  get island(): Locator {
    return this.page.getByTestId('catalog-asset-preview-island');
  }

  /** The server-rendered thumbnail image. */
  get thumbnail(): Locator {
    return this.page.getByTestId('catalog-asset-preview');
  }

  /** The "preview unavailable" placeholder (shown when no thumbnailHash). */
  get thumbnailUnavailable(): Locator {
    return this.page.getByTestId('catalog-asset-preview-unavailable');
  }

  /** The preview error notice (shown when the island fails). */
  get errorNotice(): Locator {
    return this.page.getByTestId('catalog-asset-preview-error');
  }

  /** The tileset grid overlay toggle button. */
  get gridToggle(): Locator {
    return this.page.getByTestId('catalog-tileset-grid-toggle');
  }

  /** The main asset detail container. */
  get assetContainer(): Locator {
    return this.page.getByTestId('catalog-asset');
  }

  /** Navigate to an asset detail page and wait for the container. */
  async goto(tag: string): Promise<void> {
    await this.page.goto(`/catalog/lpc/${encodeURIComponent(tag)}`);
    await this.assetContainer.waitFor({ state: 'visible' });
  }
}
