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

const NARRATIVE_LABELS: Readonly<Record<string, string>> = {
  likes: 'Likes',
  temptations: 'Temptations',
  keys: 'Keys',
};

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

  get jsonEditToggle() {
    return this.card.getByRole('checkbox', { name: 'Edit JSON', exact: true });
  }

  get jsonTextarea() {
    return this.card.locator('textarea.font-mono');
  }

  get jsonError() {
    return this.card.getByRole('alert');
  }

  // ── Ability Scores ────────────────────────────

  abilityRow(key: string) {
    return this.card
      .locator('.game-ability-grid__item')
      .filter({ has: this.page.getByText(key, { exact: true }) });
  }

  abilityInput(key: string) {
    return this.card.getByRole('spinbutton', { name: `${key} score`, exact: true });
  }

  abilityModifier(key: string) {
    return this.abilityRow(key).locator('span.game-numeric').last();
  }

  // ── Skills ────────────────────────────────────

  skillRow(name: string) {
    return this.card
      .locator('.game-surface--inset')
      .filter({ has: this.page.getByText(name, { exact: true }) });
  }

  skillProficiencyCheckbox(name: string) {
    return this.card.getByRole('checkbox', { name: `Proficiency in ${name}`, exact: true });
  }

  skillExpertiseCheckbox(name: string) {
    return this.card.getByRole('checkbox', { name: `Expertise in ${name}`, exact: true });
  }

  // ── Narrative Traits ──────────────────────────

  narrativeSection(category: string) {
    const label = NARRATIVE_LABELS[category] ?? category;
    return this.card
      .locator('div.game-surface--inset')
      .filter({ has: this.page.getByRole('heading', { name: label, exact: true }) })
      .last();
  }

  narrativeChips(category: string) {
    return this.narrativeSection(category).locator('.game-badge');
  }

  narrativeAddInput(category: string) {
    const label = (NARRATIVE_LABELS[category] ?? category).toLowerCase();
    return this.narrativeSection(category).getByPlaceholder(`Add a ${label} trait`, {
      exact: true,
    });
  }

  narrativeAddButton(category: string) {
    return this.narrativeSection(category).getByRole('button', { name: 'Add', exact: true });
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
    let tabEl: import('@playwright/test').Locator;
    if (tab === 'abilities') {
      tabEl = this.tabAbilities;
    } else if (tab === 'skills') {
      tabEl = this.tabSkills;
    } else {
      tabEl = this.tabTraits;
    }
    await expect(tabEl).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
  }

  async expectModifier(key: string, modifier: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.abilityModifier(key)).toContainText(modifier, { timeout: 3_000 });
  }
}
