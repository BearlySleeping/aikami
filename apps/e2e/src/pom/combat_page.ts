// apps/e2e/src/pom/combat_page.ts
// Page Object Model — CombatPage
//
// Encapsulates locators and interaction primitives for the Combat overlay
// and /dev/combat sandbox. Handles attack/defend/flee actions, custom AI
// action input, combat log inspection, and state verification.
//
// DOM reference: apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte

import type { Page } from '@playwright/test';

export class CombatPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the combat dev sandbox. */
  async gotoDev(): Promise<void> {
    // useRealAi=false ensures mock resolution for fast, deterministic tests
    await this.page.goto('http://localhost:5274/dev/combat?useRealAi=false', {
      waitUntil: 'domcontentloaded',
    });
    await this.waitReady();
  }

  /** Navigate to the combat-enhancements dev sandbox (C-234 Dice & Initiative). */
  async gotoCombatEnhancementsDev(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/combat-enhancements', {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForSelector('h1', { timeout: 10_000 });
  }

  /** Navigate to game combat (requires game engine + active encounter). */
  async gotoGame(): Promise<void> {
    await this.page.goto('http://localhost:5274/game', { waitUntil: 'domcontentloaded' });
  }

  /** Wait for combat UI to render. */
  async waitReady(): Promise<void> {
    await this.page.waitForSelector('[data-testid="combat-attack-btn"]', { timeout: 10_000 });
  }

  // ── Action Buttons ────────────────────────────────────────

  get attackButton() {
    return this.page.locator('[data-testid="combat-attack-btn"]');
  }

  get defendButton() {
    return this.page.locator('[data-testid="combat-defend-btn"]');
  }

  get fleeButton() {
    return this.page.locator('[data-testid="combat-flee-btn"]');
  }

  async clickAttack(): Promise<void> {
    await this.attackButton.click();
  }

  async clickDefend(): Promise<void> {
    await this.defendButton.click();
  }

  async clickFlee(): Promise<void> {
    await this.fleeButton.click();
  }

  // ── Custom AI Action Input ────────────────────────────────

  get customActionInput() {
    return this.page.locator('[data-testid="combat-custom-action-input"]');
  }

  get customActionSubmit() {
    return this.page.locator('[data-testid="combat-custom-action-submit"]');
  }

  async typeCustomAction(text: string): Promise<void> {
    await this.customActionInput.fill(text);
  }

  async submitCustomAction(): Promise<void> {
    await this.customActionSubmit.click();
  }

  // ── Combat Log ────────────────────────────────────────────

  /** Combat log container — the scrollable area with log entries. */
  get combatLog() {
    return this.page.locator('.flex-1.overflow-y-auto.min-h-0').first();
  }

  async expectLogContains(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.combatLog).toContainText(text, { timeout: 5_000 });
  }

  async expectLogVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.combatLog).toBeVisible();
  }

  // ── Tab Navigation ────────────────────────────────────────

  /** Switch to the Gallery tab where the Generate Scene button lives. */
  async switchToGalleryTab(): Promise<void> {
    await this.page.locator('.tab').filter({ hasText: 'Gallery' }).click();
    await this.page.waitForTimeout(300);
  }

  /** Switch to the Log tab. */
  async switchToLogTab(): Promise<void> {
    await this.page.locator('.tab').filter({ hasText: 'Log' }).click();
    await this.page.waitForTimeout(300);
  }

  // ── Dice UI ───────────────────────────────────────────────

  get diceOverlay() {
    return this.page.locator('.dice-roll-overlay');
  }

  get spinningDie() {
    return this.page.locator('.d20-spinning');
  }

  get revealedDie() {
    return this.page.locator('.d20-reveal');
  }

  get diceValue() {
    return this.page.locator('.d20-value');
  }

  get diceResultLabel() {
    return this.page.locator('.dice-container .text-lg').first();
  }

  // ── Scene Image ───────────────────────────────────────────

  get generateSceneButton() {
    return this.page.locator('[data-testid="combat-generate-scene-btn"]');
  }

  // ── Portrait Stage (DOM-based combat UI) ──────────────────

  get portraitStage() {
    return this.page.locator('[data-testid="combat-portrait-stage"]');
  }

  get portraitImages() {
    return this.portraitStage.locator('img');
  }

  // C-234 ── Dice Quick Menu ────────────────────────────────

  /** Dice quick menu container. */
  get diceQuickMenu() {
    return this.page.locator('.dice-quick-menu');
  }

  /** Custom dice notation input field. */
  get diceCustomInput() {
    return this.diceQuickMenu.locator('input[placeholder*="e.g."]');
  }

  /** Custom dice add button. */
  get diceCustomAddButton() {
    return this.diceQuickMenu.locator('button:has-text("+Add")');
  }

  /** Roll All button (visible when dice are queued). */
  get diceRollAllButton() {
    return this.diceQuickMenu.locator('button:has-text("Roll All")');
  }

  /** Queued dice roll badges. */
  get diceQueuedBadges() {
    return this.diceQuickMenu.locator('.badge');
  }

  /** Queue a specific dice preset by label. */
  async queueDicePreset(label: string): Promise<void> {
    await this.diceQuickMenu.locator(`button:has-text("${label}")`).click();
  }

  // C-234 ── Initiative Tracker ──────────────────────────────

  /** Initiative tracker container. */
  get initiativeTracker() {
    return this.page.locator('.initiative-tracker');
  }

  /** Initiative tracker header button (for collapse toggle). */
  get initiativeTrackerHeader() {
    return this.initiativeTracker.locator('button').first();
  }

  // C-234 ── Turn Tracker Header ────────────────────────────

  /** Turn tracker header container. */
  get turnTrackerHeader() {
    return this.page.locator('.turn-tracker-header');
  }

  // C-234 ── Combat State ────────────────────────────────────

  /** Wait for combat to end (attack button becomes visible again after resolution). */
  async waitForActionReady(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="combat-attack-btn"]',
        ) as HTMLButtonElement;
        return btn && !btn.disabled;
      },
      undefined,
      { timeout: 15_000 },
    );
  }

  async expectVictoryBanner(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('text=Victory')).toBeVisible({ timeout: 5_000 });
  }

  async expectDefeatBanner(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('text=Defeat')).toBeVisible({ timeout: 5_000 });
  }
}
