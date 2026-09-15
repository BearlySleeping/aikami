// apps/e2e/src/pom/combat_page.ts
// Page Object Model — CombatPage
//
// Encapsulates locators and interaction primitives for the Combat overlay
// and /dev/combat sandbox. Handles attack/defend/flee actions, custom AI
// action input, combat log inspection, and state verification.
//
// DOM reference: apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte

import { expect, type Page } from '@playwright/test';

type AikamiTestSeam = {
  startRealEncounter: (options: { encounterId: string; engine?: 'legacy' | 'v2' }) => void;
  travelToEncounterMap: (options: { encounterId: string }) => Promise<void>;
  isCombatStartRoutable?: () => boolean;
  isMapReady?: () => boolean;
};

type CombatHighlightDebug = {
  cellX: number;
  cellY: number;
  kind: 'reachable' | 'target';
  screenX: number;
  screenY: number;
};

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

  /** Boot the production game route, travel to an authored encounter, and start v2 combat. */
  async bootAuthoredEnvironmentEncounter(encounterId: string): Promise<void> {
    await this.page.goto('/game', { waitUntil: 'domcontentloaded' });
    await expect(this.gameCanvas).toBeAttached({ timeout: 30_000 });
    await this.page.waitForFunction(
      () =>
        typeof (window as unknown as { __AIKAMI_TEST__?: AikamiTestSeam }).__AIKAMI_TEST__
          ?.startRealEncounter === 'function',
      undefined,
      { timeout: 20_000 },
    );
    await this.page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: AikamiTestSeam }
        ).__AIKAMI_TEST__?.isCombatStartRoutable?.() === true,
      undefined,
      { timeout: 40_000 },
    );
    await this.waitForMapReady();
    await this.page.evaluate(
      (id) =>
        (
          window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
        ).__AIKAMI_TEST__.travelToEncounterMap({ encounterId: id }),
      encounterId,
    );
    await this.waitForMapReady();
    await this.page.waitForTimeout(1_000);

    await expect
      .poll(
        async () => {
          await this.page.evaluate(
            (id) =>
              (
                window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
              ).__AIKAMI_TEST__.startRealEncounter({ encounterId: id, engine: 'v2' }),
            encounterId,
          );
          return this.combatBudget.isVisible().catch(() => false);
        },
        { timeout: 45_000, intervals: [500, 1000, 2000, 2000, 3000, 3000, 5000] },
      )
      .toBe(true);
    await expect(this.objectInspector).toBeVisible({ timeout: 20_000 });
  }

  private async waitForMapReady(): Promise<void> {
    await this.page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: AikamiTestSeam }
        ).__AIKAMI_TEST__?.isMapReady?.() === true,
      undefined,
      { timeout: 45_000 },
    );
  }

  /** Wait for combat UI to render. */
  async waitReady(): Promise<void> {
    await this.page.waitForSelector('[data-testid="combat-attack-btn"]', { timeout: 10_000 });
  }

  get gameCanvas() {
    return this.page.locator('#game-canvas-container canvas');
  }

  get combatBudget() {
    return this.page.getByTestId('combat-budget-dots');
  }

  get objectInspector() {
    return this.page.getByTestId('combat-object-inspector');
  }

  objectRow(objectId: string) {
    return this.page.getByTestId(`combat-object-${objectId}`);
  }

  objectAction(affordanceId: string) {
    return this.page.getByTestId(`combat-object-action-${affordanceId}`);
  }

  get objectPreview() {
    return this.page.getByTestId('combat-object-preview');
  }

  async expectAuthoredObjects(objectIds: readonly string[]): Promise<void> {
    for (const objectId of objectIds) {
      await expect(this.objectRow(objectId)).toBeVisible();
    }
  }

  async selectAuthoredObject(objectId: string): Promise<void> {
    await this.objectRow(objectId).click();
  }

  async previewObjectAction(affordanceId: string): Promise<void> {
    await this.objectAction(affordanceId).click({ force: true });
    await expect(this.objectPreview).toBeVisible({ timeout: 15_000 });
  }

  async expectObjectActionUnavailable(affordanceId: string): Promise<void> {
    const action = this.objectAction(affordanceId);
    await expect(action).toBeDisabled();
    await expect(action).toContainText(/unavailable.+combat\.invalid\./i);
  }

  async expectObjectActionEnabled(affordanceId: string): Promise<void> {
    await expect(this.objectAction(affordanceId)).toBeEnabled();
  }

  async expectPreviewContains(expected: string | RegExp): Promise<void> {
    await expect(this.objectPreview).toContainText(expected);
  }

  async expectObjectUnchanged(objectId: string, state: string | RegExp): Promise<void> {
    await expect(this.page.getByTestId('combat-object-confirm')).toBeVisible();
    await expect(this.objectRow(objectId)).toContainText(state);
  }

  async confirmObjectAction(): Promise<void> {
    await this.page.getByTestId('combat-object-confirm').click({ force: true });
  }

  async expectObjectState(objectId: string, expected: string | RegExp): Promise<void> {
    await expect
      .poll(
        async () => {
          await this.page
            .getByTestId('combat-object-refresh')
            .click({ force: true })
            .catch(() => {});
          return this.objectRow(objectId).innerText();
        },
        { timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] },
      )
      .toMatch(expected);
  }

  /** Move to an engine-published reachable cell adjacent to the selected object. */
  async moveActorAdjacentTo(cell: { x: number; y: number }): Promise<void> {
    const budgetBefore = await this.combatBudget.innerText();
    await this.page.getByTestId('combat-move-btn').click();
    await expect(this.page.getByTestId('combat-move-hint')).toBeVisible({ timeout: 15_000 });
    let destination: CombatHighlightDebug | undefined;
    await expect
      .poll(
        async () => {
          const highlights = await this.page.evaluate(
            (): CombatHighlightDebug[] =>
              (
                window as unknown as {
                  __AIKAMI_DEBUG__?: { combatHighlights?: CombatHighlightDebug[] };
                }
              ).__AIKAMI_DEBUG__?.combatHighlights ?? [],
          );
          destination = highlights.find(
            (entry) =>
              entry.kind === 'reachable' &&
              Math.abs(entry.cellX - cell.x) + Math.abs(entry.cellY - cell.y) === 1 &&
              Number.isFinite(entry.screenX) &&
              Number.isFinite(entry.screenY),
          );
          return destination !== undefined;
        },
        { timeout: 15_000, intervals: [200, 300, 500, 1000, 2000] },
      )
      .toBe(true);
    if (destination === undefined) {
      throw new Error(`No reachable cell was adjacent to (${cell.x}, ${cell.y})`);
    }
    await this.gameCanvas.click({
      position: { x: destination.screenX, y: destination.screenY },
      timeout: 10_000,
    });
    await expect
      .poll(() => this.combatBudget.innerText(), { timeout: 15_000 })
      .not.toBe(budgetBefore);
    await this.page.getByTestId('combat-object-refresh').click({ force: true });
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
    await expect(this.combatLog).toContainText(text, { timeout: 5_000 });
  }

  async expectLogVisible(): Promise<void> {
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
  // Selectors track the shared GameDice component (game_dice.svelte).

  get diceOverlay() {
    return this.page.locator('.dice-overlay');
  }

  get spinningDie() {
    return this.page.locator('.d20-die.spinning');
  }

  get revealedDie() {
    return this.page.locator('.d20-die.revealed');
  }

  get diceValue() {
    return this.page.locator('.d20-value');
  }

  get diceResultLabel() {
    return this.page.locator('.dice-overlay .text-lg').first();
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
    await expect(this.page.locator('text=Victory')).toBeVisible({ timeout: 5_000 });
  }

  async expectDefeatBanner(): Promise<void> {
    await expect(this.page.locator('text=Defeat')).toBeVisible({ timeout: 5_000 });
  }
}
