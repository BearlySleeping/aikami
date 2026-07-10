// apps/e2e/src/pom/image_gen_page.ts
// Page Object Model — ImageGenPage
//
// Encapsulates locators and interaction primitives for the Image Generation
// Pipeline dev sandbox (/dev/image-gen).
//
// Contract: C-242 Image Generation Pipeline

import type { Page } from '@playwright/test';

export class ImageGenPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the image gen dev sandbox. */
  async gotoDev(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/image-gen', {
      waitUntil: 'domcontentloaded',
    });
    await this.waitReady();
  }

  /** Wait for the sandbox page to render. */
  async waitReady(): Promise<void> {
    await this.page.waitForSelector('h1', { timeout: 10_000 });
  }

  // ── Tab navigation ────────────────────────────────────────

  get profilesTab() {
    return this.page.locator('.tab').filter({ hasText: 'Profiles' });
  }

  get compilerTab() {
    return this.page.locator('.tab').filter({ hasText: 'Compiler' });
  }

  get triggersTab() {
    return this.page.locator('.tab').filter({ hasText: 'Triggers' });
  }

  get galleryTab() {
    return this.page.locator('.tab').filter({ hasText: 'Gallery' });
  }

  async clickTab(name: string): Promise<void> {
    await this.page.locator('.tab').filter({ hasText: name }).click();
    await this.page.waitForTimeout(300);
  }

  // ── Profiles tab ──────────────────────────────────────────

  get activeProfileSelect() {
    return this.page.locator('select').first();
  }

  get cloneButton() {
    return this.page.getByRole('button', { name: '📋 Clone' });
  }

  get editButton() {
    return this.page.getByRole('button', { name: '✏️ Edit' });
  }

  get deleteButton() {
    return this.page.getByRole('button', { name: '🗑️ Delete' });
  }

  async selectProfile(name: string): Promise<void> {
    const options = this.activeProfileSelect.locator('option');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent();
      if (text?.includes(name)) {
        await this.activeProfileSelect.selectOption({ index: i });
        break;
      }
    }
  }

  // ── Compiler tab ──────────────────────────────────────────

  get basePromptTextarea() {
    return this.page.locator('textarea').first();
  }

  get compileButton() {
    return this.page.getByRole('button', { name: '🧪 Compile Prompt' });
  }

  get compilerPositiveOutput() {
    return this.page.locator('.text-success').locator('..').locator('p');
  }

  get compilerNegativeOutput() {
    return this.page.locator('.text-error').locator('..').locator('p');
  }

  // ── Triggers tab ──────────────────────────────────────────

  get triggerEventSelect() {
    return this.page.locator('select').nth(1);
  }

  get triggerContextInput() {
    return this.page.locator('input.input-bordered').first();
  }

  get fireTriggerButton() {
    return this.page.getByRole('button', { name: '🔥 Fire Trigger' });
  }

  get triggerResultPositive() {
    return this.page.locator('text=Compiled Positive').locator('..').locator('p');
  }

  // ── Gallery tab ───────────────────────────────────────────

  get addMockButton() {
    return this.page.getByRole('button', { name: '➕ Add Mock' });
  }

  get galleryImages() {
    return this.page.locator('.break-inside-avoid');
  }

  // ── Assertions ────────────────────────────────────────────

  async expectHeader(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('h1')).toHaveText('Image Gen Pipeline');
  }

  async expectTabsVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.profilesTab).toBeVisible();
    await expect(this.compilerTab).toBeVisible();
    await expect(this.triggersTab).toBeVisible();
    await expect(this.galleryTab).toBeVisible();
  }

  async expectProfileCard(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.cloneButton).toBeVisible();
  }

  async expectCompiledOutput(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.compilerPositiveOutput).toBeVisible();
  }

  async expectGalleryHasImages(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.galleryImages.first()).toBeVisible();
  }
}
