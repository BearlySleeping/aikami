// apps/e2e/src/pom/character_sheet_page.ts
// Page Object Model — CharacterSheetPage
//
// Encapsulates locators and interaction primitives for the Character Sheet
// overlay in the game UI. Covers tab navigation, ability score editing,
// skill proficiency toggling, narrative trait chips, Pro Mode,
// and AI context preview.
//
// Contract: C-232 Character Sheet & Traits System

import type { Page } from '@playwright/test';

export class CharacterSheetPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto('http://localhost:5274', { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('body', { timeout: 15_000 });
  }

  async gotoDevSandbox(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/character-sheet', {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForSelector('.card', { timeout: 10_000 });
  }

  // ── Locators ──────────────────────────────────

  get card() {
    return this.page.locator('.card:has-text("Character Sheet")');
  }

  get proModeToggle() {
    return this.card.locator('input[type="checkbox"].toggle').first();
  }

  get tabAbilities() {
    return this.card.getByRole('tab', { name: 'Abilities' });
  }

  get tabSkills() {
    return this.card.getByRole('tab', { name: 'Skills' });
  }

  get tabTraits() {
    return this.card.getByRole('tab', { name: 'Traits' });
  }

  get aiPreviewButton() {
    return this.card.getByRole('button', { name: 'AI Context Preview' });
  }

  get jsonTextarea() {
    return this.card.locator('textarea.font-mono');
  }

  get jsonError() {
    return this.card.locator('.text-error.font-mono');
  }

  // ── Ability Scores ────────────────────────────

  abilityInput(key: string) {
    return this.card
      .locator('.stat')
      .filter({ has: this.page.locator(`.stat-title:text-is("${key}")`) })
      .locator('input[type="number"]');
  }

  abilityModifier(key: string) {
    return this.card
      .locator('.stat')
      .filter({ has: this.page.locator(`.stat-title:text-is("${key}")`) })
      .locator('span.font-mono.font-bold');
  }

  // ── Skills ────────────────────────────────────

  skillRow(name: string) {
    return this.card.locator('.flex.items-center.justify-between').filter({ hasText: name });
  }

  skillProficiencyCheckbox(name: string) {
    return this.skillRow(name).locator('input[type="checkbox"]').first();
  }

  skillExpertiseCheckbox(name: string) {
    return this.skillRow(name).locator('input[type="checkbox"]').nth(1);
  }

  // ── Narrative Traits ──────────────────────────

  narrativeChips(category: string) {
    return this.card
      .locator('div', { has: this.page.locator(`text=${category}`) })
      .locator('.badge');
  }

  narrativeAddInput(category: string) {
    return this.card
      .locator('div', { has: this.page.locator(`text=${category}`) })
      .locator('input[type="text"]');
  }

  narrativeAddButton(category: string) {
    return this.card
      .locator('div', { has: this.page.locator(`text=${category}`) })
      .locator('button:has-text("+")');
  }

  // ── Modals ────────────────────────────────────

  get aiPreviewModal() {
    return this.page.locator('.modal-box');
  }

  get aiPreviewContent() {
    return this.aiPreviewModal.locator('pre');
  }

  // ── Assertions ────────────────────────────────

  async expectVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.card).toBeVisible({ timeout: 5_000 });
  }

  async expectTabActive(tab: 'abilities' | 'skills' | 'traits'): Promise<void> {
    const { expect } = await import('@playwright/test');
    const tabEl =
      tab === 'abilities' ? this.tabAbilities : tab === 'skills' ? this.tabSkills : this.tabTraits;
    await expect(tabEl).toHaveClass(/tab-active/, { timeout: 3_000 });
  }

  async expectModifier(key: string, modifier: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.abilityModifier(key)).toContainText(modifier, { timeout: 3_000 });
  }
}
