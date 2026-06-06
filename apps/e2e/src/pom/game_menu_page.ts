// apps/e2e/src/pom/game_menu_page.ts
// Page Object Model — GameMenuPage
//
// Encapsulates locators and interaction primitives for the Game startup menu.
// Handles Start Game, Options, Quit confirmation flows, and screen transitions.
//
// DOM reference: apps/frontend/game/index.html

import type { Page } from '@playwright/test';

/**
 * Page Object Model for Game menu interactions.
 */
export class GameMenuPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /**
   * Navigate to the game root URL and wait for the menu to render.
   * Suppresses any Vite error overlay that may block pointer events.
   */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await this._suppressViteOverlay();
    await this.page.waitForSelector('#menu-screen', { state: 'visible' });
  }

  // ── Menu Screen ──────────────────────────────────────────

  async expectMenuVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#menu-screen')).toBeVisible();
  }

  async expectMenuHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#menu-screen')).not.toBeVisible();
  }

  async expectTitleAndSubtitle(options: { title: string; subtitle: string }): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#menu-screen h1')).toHaveText(options.title);
    await expect(this.page.locator('#menu-screen h2')).toHaveText(options.subtitle);
  }

  async expectPageTitle(title: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page).toHaveTitle(title);
  }

  // ── Buttons ───────────────────────────────────────────────

  async clickStart(): Promise<void> {
    await this.page.locator('#btn-start').click();
  }

  async clickOptions(): Promise<void> {
    await this.page.locator('#btn-options').click();
  }

  async clickQuit(): Promise<void> {
    await this.page.locator('#btn-quit').click();
  }

  async clickOptionsBack(): Promise<void> {
    await this.page.locator('#btn-options-back').click();
  }

  async clickQuitCancel(): Promise<void> {
    await this.page.locator('#btn-quit-cancel').click();
  }

  async clickQuitConfirm(): Promise<void> {
    await this.page.locator('#btn-quit-confirm').click();
  }

  async expectAllButtonsVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#btn-start')).toBeVisible();
    await expect(this.page.locator('#btn-options')).toBeVisible();
    await expect(this.page.locator('#btn-quit')).toBeVisible();
  }

  // ── Game Screen ──────────────────────────────────────────

  async expectGameScreenVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#game-screen')).toBeVisible();
  }

  async expectGameScreenHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#game-screen')).not.toBeVisible();
  }

  async expectCanvasVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#game-canvas')).toBeVisible();
  }

  // ── Options Panel ────────────────────────────────────────

  async expectOptionsPanelVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#options-panel')).toBeVisible();
  }

  async expectOptionsPanelHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#options-panel')).not.toBeVisible();
  }

  async expectResolutionSelect(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#select-resolution')).toBeVisible();
  }

  async selectResolution(value: string): Promise<void> {
    await this.page.locator('#select-resolution').selectOption(value);
  }

  // ── Quit Overlay ─────────────────────────────────────────

  async expectQuitOverlayVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#quit-overlay')).toBeVisible();
  }

  async expectQuitOverlayHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('#quit-overlay')).not.toBeVisible();
  }

  // ── Internal ─────────────────────────────────────────────

  /**
   * Remove the Vite error overlay if present.
   * The game dev server has an unresolved import that triggers
   * vite-error-overlay, which intercepts all pointer events.
   */
  private async _suppressViteOverlay(): Promise<void> {
    await this.page.addStyleTag({
      content: 'vite-error-overlay { display: none !important; }',
    });
  }
}
