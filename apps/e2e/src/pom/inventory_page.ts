// apps/e2e/src/pom/inventory_page.ts
// Page Object Model — InventoryPage
//
// Encapsulates locators and interaction primitives for the Inventory
// overlay in the game UI. Handles opening/closing via keyboard shortcuts,
// item inspection, and item count verification.
//
// Contract: C-142 Inventory Item Pickups

import type { Page } from '@playwright/test';

export class InventoryPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the game page and wait for engine ready. */
  async gotoGame(): Promise<void> {
    await this.page.goto('http://localhost:5274/game', { waitUntil: 'domcontentloaded' });
    await this.waitForEngineReady();
  }

  /** Wait for the game engine canvas to appear in the DOM. */
  async waitForEngineReady(): Promise<void> {
    await this.page.waitForSelector('canvas', { state: 'attached', timeout: 15_000 });
  }

  /** Check if the game engine is fully loaded (canvas is visible/rendering). */
  async isEngineLoaded(): Promise<boolean> {
    return await this.page
      .locator('canvas')
      .isVisible()
      .catch(() => false);
  }

  // ── Inventory Toggle ──────────────────────────────────────

  /** Press 'I' to toggle the inventory overlay open/closed. */
  async toggle(): Promise<void> {
    await this.page.keyboard.press('KeyI');
    await this.page.waitForTimeout(500);
  }

  /** Press Escape to close any open overlay. */
  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  // ── Locators ──────────────────────────────────────────────

  get inventoryCard() {
    return this.page.locator('.card:has-text("Inventory")');
  }

  get emptyMessage() {
    return this.page.locator('text=No items collected yet');
  }

  get itemList() {
    return this.page.locator('[data-testid="inventory-item-list"]');
  }

  /** Get the inventory overlay itself. */
  get overlay() {
    return this.page.locator('[data-testid="inventory-overlay"]');
  }

  // ── Assertions ────────────────────────────────────────────

  async expectOpen(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.inventoryCard).toBeVisible({ timeout: 5_000 });
  }

  async expectClosed(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.inventoryCard).not.toBeVisible({ timeout: 5_000 });
  }

  async expectEmpty(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.emptyMessage).toBeVisible({ timeout: 5_000 });
  }

  async expectItemCount(count: number): Promise<void> {
    const { expect } = await import('@playwright/test');
    const items = this.page.locator('[data-testid^="inventory-item-"]');
    await expect(items).toHaveCount(count, { timeout: 5_000 });
  }
}
