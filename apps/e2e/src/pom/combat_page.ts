// apps/e2e/src/pom/combat_page.ts
// Page Object Model — CombatPage
//
// Encapsulates locators and interaction primitives for the Combat overlay
// and /dev/combat sandbox. Handles attack/defend/flee actions, custom AI
// action input, combat log inspection, and state verification (HP bars,
// victory/defeat banners).
//
// Contract: C-145, C-146, C-148, C-149

import type { Page } from '@playwright/test';

export class CombatPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the combat dev sandbox. */
  async gotoDev(): Promise<void> {
    await this.page.goto('http://localhost:5274/dev/combat', { waitUntil: 'domcontentloaded' });
    await this.waitReady();
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

  get combatLog() {
    return this.page.locator('[data-testid="combat-log"]');
  }

  async expectLogContains(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.combatLog).toContainText(text, { timeout: 5_000 });
  }

  async expectLogVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.combatLog).toBeVisible();
  }

  // ── HP Bars ───────────────────────────────────────────────

  get playerHpBar() {
    return this.page.locator('[data-testid="combat-player-hp"]');
  }

  get enemyHpBar() {
    return this.page.locator('[data-testid="combat-enemy-hp"]');
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

  // ── Portrait Stage (C-167 DOM-based combat UI) ───────────

  get portraitStage() {
    return this.page.locator('[data-testid="combat-portrait-stage"]');
  }

  get portraitImages() {
    return this.portraitStage.locator('img');
  }

  // ── Combat State ──────────────────────────────────────────

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
