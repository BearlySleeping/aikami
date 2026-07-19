// apps/e2e/src/pom/game_page.ts
// Page Object Model — GamePage
//
// Encapsulates locators and interaction primitives for the production
// /game route. Provides production-route locomotion, NPC interaction,
// quest acceptance, combat trigger, inventory, save, and reload
// primitives for the release gate E2E spec.
//
// Contract: C-335 — Enforce the Playable Demo Release Gate
//
// DOM reference: apps/frontend/client/src/routes/game/+page.svelte
//                apps/frontend/client/src/lib/views/game/game_view.svelte

import type { Page } from '@playwright/test';

export type GamePageOptions = {
  /** Whether to use the QA bypass flag to skip text AI requirement */
  bypassTextAi?: boolean;
};

export type GameJourneyCheckpoint = {
  /** Human-readable label for the checkpoint (e.g. 'post-combat-reward') */
  label: string;
  /** Route path at this checkpoint */
  route: string;
  /** Expected game mode at this checkpoint */
  expectedMode: 'explore' | 'combat' | 'dialogue' | 'menu';
};

export class GamePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the production /game route and wait for engine ready. */
  async goto(options?: GamePageOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options?.bypassTextAi) {
      params.set('bypassTextAi', 'true');
    }
    const query = params.toString();
    const url = `http://localhost:5274/game${query ? `?${query}` : ''}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitForEngineReady();
  }

  /**
   * Navigate from the start menu, through onboarding, to the game.
   * Simulates the full cold-launch flow: / → start menu → /setup → /game.
   */
  async gotoColdLaunch(): Promise<void> {
    // Start at root
    await this.page.goto('http://localhost:5274/', { waitUntil: 'domcontentloaded' });

    // Click "New Game" or equivalent start button
    const startButton = this.page.getByRole('button', { name: /new game|start|play/i });
    if (await startButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startButton.click();
    }

    // Wait for navigation to /setup or /game
    await this.page.waitForURL(/\/(setup|game)/, { timeout: 15_000 });

    // If we land on /setup, go through onboarding quickly
    if (this.page.url().includes('/setup')) {
      await this._completeOnboarding();
    }

    // Wait for /game
    await this.page.waitForURL(/\/game/, { timeout: 30_000 });
    await this.waitForEngineReady();
  }

  /** Wait for the game engine canvas to render and the HUD to appear. */
  async waitForEngineReady(): Promise<void> {
    // Wait for canvas container
    await this.page.waitForSelector('#game-canvas-container', {
      state: 'attached',
      timeout: 15_000,
    });

    // Wait for canvas element
    await this.page.waitForSelector('#game-canvas-container canvas', {
      state: 'attached',
      timeout: 30_000,
    });

    // Wait for HUD to appear (player HUD is the visual indicator of engine ready)
    const playerHud = this.page.locator('.bg-base-200\\/80');
    await playerHud.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {
      // HUD may not appear if boot fails — that's fine, caller checks
    });
  }

  /** Wait for boot to reach the "playing" state (HUD visible, loading overlay gone). */
  async waitForPlayingState(): Promise<void> {
    // Wait for loading overlay to disappear
    const loadingText = this.page.getByText('Loading game engine...');
    await loadingText.waitFor({ state: 'hidden', timeout: 30_000 });

    // Confirm HUD is visible
    const playerHud = this.page.locator('.bg-base-200\\/80');
    await playerHud.waitFor({ state: 'visible', timeout: 10_000 });
  }

  // ── Private onboarding helper ─────────────────────────────

  /**
   * Speed through onboarding steps to reach /game.
   * Clicks through starter selection, identity, play style, and appearance.
   */
  private async _completeOnboarding(): Promise<void> {
    // Each onboarding step has a "Next" or "Continue" button.
    // We click through them deterministically using text-based selectors.
    const maxSteps = 8;
    for (let i = 0; i < maxSteps; i++) {
      if (this.page.url().includes('/game')) {
        break;
      }

      const nextButton = this.page.getByRole('button', {
        name: /next|continue|finish|start/i,
      });
      if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextButton.click();
        await this.page.waitForTimeout(500);
      } else {
        break;
      }
    }
  }

  // ── Locators ──────────────────────────────────────────────

  /** The game canvas container div. */
  get canvasContainer() {
    return this.page.locator('#game-canvas-container');
  }

  /** The PixiJS canvas element. */
  get canvas() {
    return this.page.locator('#game-canvas-container canvas');
  }

  /** The game UI overlay layer (DOM overlays). */
  get uiLayer() {
    return this.page.locator('#game-ui-layer');
  }

  /** Player HUD — the always-visible bottom-left overlay. */
  get playerHud() {
    return this.page.locator('.bg-base-200\\/80');
  }

  /** HP progress bar with ARIA role. */
  get hpBar() {
    return this.page.getByRole('progressbar', { name: 'Player HP' });
  }

  // ── Pause Menu ────────────────────────────────────────────

  /** Open the pause menu via Escape key. */
  async openPauseMenu(): Promise<void> {
    await this.page.keyboard.press('Escape');
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText('Resume Game')).toBeVisible({ timeout: 5000 });
  }

  /** Close pause menu (resume game). */
  async closePauseMenu(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  /** Click "Save Game" in pause menu. */
  async saveGame(): Promise<void> {
    await this.openPauseMenu();
    const saveButton = this.page.getByRole('button', { name: /save/i });
    if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveButton.click();
      await this.page.waitForTimeout(500);
    }
    await this.closePauseMenu();
  }

  // ── Inventory ─────────────────────────────────────────────

  /** Toggle inventory overlay via 'I' key. */
  async toggleInventory(): Promise<void> {
    await this.page.keyboard.press('KeyI');
    await this.page.waitForTimeout(500);
  }

  /** Assert inventory overlay is visible. */
  async expectInventoryOpen(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('[data-testid="inventory-overlay"]')).toBeVisible({
      timeout: 5000,
    });
  }

  /** Assert inventory overlay is closed. */
  async expectInventoryClosed(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('[data-testid="inventory-overlay"]')).not.toBeVisible({
      timeout: 5000,
    });
  }

  // ── NPC Interaction ───────────────────────────────────────

  /**
   * Walk toward the nearest NPC using arrow keys and interact.
   * In the demo, the NPC spawns near the player.
   */
  async approachAndTalkToNpc(): Promise<void> {
    // Walk a few steps toward NPC spawn point (typically south-east)
    for (let i = 0; i < 8; i++) {
      await this.page.keyboard.press('ArrowRight');
      await this.page.waitForTimeout(100);
    }
    for (let i = 0; i < 4; i++) {
      await this.page.keyboard.press('ArrowDown');
      await this.page.waitForTimeout(100);
    }

    // Press Enter/Space to interact with NPC
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(1000);
  }

  // ── Dialogue ──────────────────────────────────────────────

  /** Assert dialogue overlay is visible with NPC name and choices. */
  async expectDialogueVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    // Dialogue renders as an overlay in the game UI layer
    const dialogueOverlay = this.page.locator(
      '[data-testid="dialogue-overlay"], .dialogue-overlay',
    );
    await expect(dialogueOverlay).toBeVisible({ timeout: 10_000 });
  }

  /** Select a dialogue choice by index (0-based). */
  async selectDialogueChoice(index: number): Promise<void> {
    const { expect } = await import('@playwright/test');
    const choices = this.page.locator('[data-testid^="dialogue-choice-"], .dialogue-choice');
    await expect(choices.nth(index)).toBeVisible({ timeout: 5000 });
    await choices.nth(index).click();
    await this.page.waitForTimeout(500);
  }

  /** Skip through dialogue by pressing Enter or clicking choices. */
  async skipDialogue(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const choices = this.page.locator('[data-testid^="dialogue-choice-"], .dialogue-choice');
      const count = await choices.count().catch(() => 0);
      if (count > 0) {
        await choices.first().click();
        await this.page.waitForTimeout(300);
      } else {
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(300);
      }

      // If dialogue overlay is gone, we're done
      const overlay = this.page.locator('[data-testid="dialogue-overlay"], .dialogue-overlay');
      if (!(await overlay.isVisible({ timeout: 1000 }).catch(() => false))) {
        break;
      }
    }
  }

  // ── Combat ────────────────────────────────────────────────

  /** Assert combat UI is visible (sidebars with HP bars and action buttons). */
  async expectCombatActive(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('[data-testid="combat-attack-btn"]')).toBeVisible({
      timeout: 15_000,
    });
  }

  /** Click the Attack button in combat. */
  async clickAttack(): Promise<void> {
    await this.page.locator('[data-testid="combat-attack-btn"]').click();
    await this.page.waitForTimeout(500);
  }

  /** Wait for combat to resolve (attack button re-enabled after round). */
  async waitForCombatActionReady(): Promise<void> {
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

  /** Assert combat has ended (victory or defeat banner, or attack button hidden). */
  async expectCombatEnded(): Promise<void> {
    const { expect } = await import('@playwright/test');
    // Either a victory/defeat banner or the combat sidebar is gone
    const banner = this.page.locator('text=/Victory|Defeat/');
    const attackBtn = this.page.locator('[data-testid="combat-attack-btn"]');

    // Poll the combined combat-ended conditions with toPass
    await expect(async () => {
      const bannerVisible = await banner.isVisible({ timeout: 1000 }).catch(() => false);
      const attackHidden = await attackBtn.isHidden({ timeout: 1000 }).catch(() => false);

      // Assert that either victory/defeat banner is visible OR attack button is hidden
      expect(bannerVisible || attackHidden).toBe(true);
    }).toPass({ timeout: 15_000 });
  }

  // ── Quest Tracker ─────────────────────────────────────────

  /** Assert the quest tracker HUD element is visible. */
  async expectQuestTrackerVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    const tracker = this.page.locator('[data-testid="quest-tracker"], .quest-tracker');
    await expect(tracker).toBeVisible({ timeout: 10_000 });
  }

  // ── Save & Reload ─────────────────────────────────────────

  /** Trigger page reload and wait for re-boot to playing state. */
  async reloadAndWaitForBoot(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForEngineReady();
    await this.waitForPlayingState();
  }

  // ── State Inspection ──────────────────────────────────────

  /**
   * Read current HP from the HP bar ARIA attribute.
   * Returns the current HP value as a number.
   */
  async getPlayerHp(): Promise<number> {
    const ariaValueNow = await this.hpBar.getAttribute('aria-valuenow');
    return Number(ariaValueNow ?? 0);
  }

  /**
   * Read the player's world position from the game state.
   * Uses page.evaluate to access the game engine state.
   */
  async getPlayerPosition(): Promise<{ x: number; y: number } | null> {
    return this.page.evaluate(() => {
      // Access game engine state through the window or game container
      const gameContainer = document.querySelector('#game-canvas-container');
      if (!gameContainer) {
        return null;
      }
      // Game position may be stored as a data attribute on the container
      const x = gameContainer.getAttribute('data-player-x');
      const y = gameContainer.getAttribute('data-player-y');
      if (x !== null && y !== null) {
        return { x: Number(x), y: Number(y) };
      }
      return null;
    });
  }

  // ── Capability Screen ─────────────────────────────────────

  /** Assert the AI capability warning screen is visible (blocks gameplay). */
  async expectCapabilityScreenVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    // Look for the capability gate message
    const capabilityMsg = this.page.getByText(/text ai|ai provider|capability|offline/i);
    await expect(capabilityMsg.first()).toBeVisible({ timeout: 10_000 });
  }

  /** Assert the start menu does NOT proceed to /setup (AI capability gate active). */
  async expectCannotStartNewGame(): Promise<void> {
    const { expect } = await import('@playwright/test');
    const startButton = this.page.getByRole('button', { name: /new game|start|play/i });
    if (await startButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startButton.click();
      await this.page.waitForTimeout(2000);
      // Should still be on the same page (not navigated to /setup or /game)
      await expect(this.page).not.toHaveURL(/\/(setup|game)/, { timeout: 5000 });
    }
  }
}
