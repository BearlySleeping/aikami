// apps/e2e/src/pom/map_sandbox_page.ts

import type { Locator, Page } from '@playwright/test';

/** Page Object Model for the client map sandbox. */
export class MapSandboxPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get canvas(): Locator {
    return this.page.getByLabel('Walk sandbox', { exact: true });
  }

  /** Clicks at canvas-relative coordinates using the browser mouse. */
  async clickCanvasAt(options: { x: number; y: number }): Promise<void> {
    const box = await this.canvas.boundingBox();
    if (!box) {
      throw new Error('Map sandbox canvas is not visible');
    }
    await this.page.mouse.click(box.x + options.x, box.y + options.y);
  }
}
