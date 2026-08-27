// apps/e2e/src/pom/sandbox_page.ts
// Page Object Model for the hub walk sandbox route.

import type { Locator, Page } from '@playwright/test';

/**
 * Page Object Model for the hub walk sandbox (/sandbox/[mapTag]).
 * Encapsulates sandbox canvas, HUD, overlays, and player interaction.
 */
export class SandboxPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Selectors ──────────────────────────────────────────────────────────

  get canvas(): Locator {
    return this.page.getByTestId('sandbox-canvas');
  }

  get hud(): Locator {
    return this.page.getByTestId('sandbox-hud');
  }

  get playerCell(): Locator {
    return this.page.getByTestId('sandbox-player-cell');
  }

  get errorMessage(): Locator {
    return this.page.getByTestId('sandbox-error');
  }

  get loadingIndicator(): Locator {
    return this.page.getByTestId('sandbox-loading');
  }

  collisionOverlayToggle(): Locator {
    return this.page.getByTestId('sandbox-overlay-toggle-collision');
  }

  // ── Actions ────────────────────────────────────────────────────────────

  async focusCanvas(): Promise<void> {
    await this.canvas.focus();
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async enableCollisionOverlay(): Promise<void> {
    await this.collisionOverlayToggle().click();
  }

  // ── Assertions helpers ─────────────────────────────────────────────────

  async waitForReady(options?: { timeout?: number }): Promise<void> {
    await this.canvas.waitFor({ state: 'visible', timeout: options?.timeout ?? 15000 });
  }

  async getPlayerCellText(): Promise<string | null> {
    return this.playerCell.textContent();
  }

  async isCollisionOverlayActive(): Promise<boolean> {
    const className = await this.collisionOverlayToggle().getAttribute('class');
    return className?.includes('btn-primary') ?? false;
  }

  async getErrorText(): Promise<string | null> {
    return this.errorMessage.textContent();
  }
}
