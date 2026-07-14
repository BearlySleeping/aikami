// apps/e2e/src/pom/cyoa_page.ts
// Page Object Model — CyoaPage
//
// Encapsulates locators and interaction primitives for the CYOA choices
// dev sandbox (/dev/cyoa).
//
// Contract: C-245 CYOA Choices Branching Narrative

import type { Page } from '@playwright/test';

export class CyoaPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the CYOA dev sandbox. */
  async gotoDev(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/cyoa', {
      waitUntil: 'domcontentloaded',
    });
    await this.waitReady();
  }

  /** Wait for the sandbox page to render. */
  async waitReady(): Promise<void> {
    await this.page.waitForSelector('h1', { timeout: 10_000 });
  }

  // ── Locators ──────────────────────────────────────────────

  get narrative() {
    return this.page.getByTestId('cyoa-sandbox-narrative');
  }

  get choiceStack() {
    return this.page.getByTestId('cyoa-choices');
  }

  get choiceButtons() {
    return this.choiceStack.locator('button');
  }

  get selectedAlert() {
    return this.page.getByTestId('cyoa-sandbox-selected');
  }

  get historyList() {
    return this.page.getByTestId('cyoa-sandbox-history');
  }

  get historyEmpty() {
    return this.page.getByTestId('cyoa-sandbox-history-empty');
  }

  get loadMockButton() {
    return this.page.getByTestId('cyoa-sandbox-load-mock');
  }

  get loadSingleButton() {
    return this.page.getByTestId('cyoa-sandbox-load-single');
  }

  get loadEmptyButton() {
    return this.page.getByTestId('cyoa-sandbox-load-empty');
  }

  get dismissButton() {
    return this.page.getByTestId('cyoa-sandbox-dismiss');
  }

  get clearHistoryButton() {
    return this.page.getByTestId('cyoa-sandbox-clear-history');
  }

  // ── Actions ───────────────────────────────────────────────

  /** Click the Nth choice button (0-indexed). */
  async selectChoice(index: number): Promise<void> {
    await this.choiceButtons.nth(index).click();
  }

  async loadMockChoices(): Promise<void> {
    await this.loadMockButton.click();
  }

  async loadSingleChoice(): Promise<void> {
    await this.loadSingleButton.click();
  }

  async loadEmptyChoices(): Promise<void> {
    await this.loadEmptyButton.click();
  }

  async dismissChoices(): Promise<void> {
    await this.dismissButton.click();
  }

  async clearHistory(): Promise<void> {
    await this.clearHistoryButton.click();
  }

  // ── Assertions ────────────────────────────────────────────

  async expectHeadingVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('h1')).toContainText('CYOA Choices Sandbox');
  }

  async expectChoiceCount(count: number): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.choiceButtons).toHaveCount(count);
  }

  async expectChoicesHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.choiceStack).toHaveCount(0);
  }

  async expectAllChoicesDisabled(): Promise<void> {
    const { expect } = await import('@playwright/test');
    const count = await this.choiceButtons.count();
    for (let i = 0; i < count; i++) {
      await expect(this.choiceButtons.nth(i)).toBeDisabled();
    }
  }

  async expectSelectedLabel(label: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.selectedAlert).toContainText(label);
  }

  async expectHistoryContains(label: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.historyList).toContainText(label);
  }

  async expectHistoryEmpty(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.historyEmpty).toBeVisible();
  }

  async expectSkillCheckBadge(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.choiceStack.locator('.badge', { hasText: text })).toBeVisible();
  }
}
