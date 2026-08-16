// apps/e2e/src/pom/dialogue_page.ts
// Page Object Model — Dialogue (C-401 streaming)
//
// Targets the dev dialogue sandbox route (/dev/sandbox/dialogue) which mounts
// the production DialogueOverlay with a stubbed slow streaming provider.
// Provides locators + assertions for streaming narrative (AC-1), the skill
// check dice flow (AC-2), and clean abort (AC-3).
//
// Contract: C-401 Stream Dialogue Narrative

import type { Page } from '@playwright/test';

export class DialoguePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the dialogue sandbox and wait for the overlay + input. */
  async goto(options?: { stall?: boolean }): Promise<void> {
    const query = options?.stall ? '?stall=1' : '';
    await this.page.goto(`/dev/sandbox/dialogue${query}`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForSelector('textarea', { state: 'visible', timeout: 15_000 });
    // The greeting renders only after the ViewModel constructor completes —
    // waiting on it guarantees the input's event listeners are attached, so
    // a subsequent fill() reliably propagates into viewModel.inputText.
    await this.page.getByText('Ah, a traveler!').waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.waitForTimeout(300);
    await this.expectDialogueVisible();
  }

  // ── Locators ──────────────────────────────────────────────

  /** The dialogue overlay root. */
  get overlay() {
    return this.page.locator('[data-testid="dialogue-overlay"]');
  }

  /** Free-text input. */
  get input() {
    return this.page.locator('textarea').first();
  }

  /** The send/cancel button (title switches between Send and Cancel). */
  get sendButton() {
    return this.page.getByTitle('Send');
  }

  /** The cancel streaming button (visible while streaming). */
  get cancelButton() {
    return this.page.getByTitle('Cancel');
  }

  /** The End Chat button in the overlay header. */
  get endChatButton() {
    return this.page.getByRole('button', { name: 'End Chat' });
  }

  /** The ARIA live region where streamed narrative renders (C-401). */
  get streamingRegion() {
    return this.page.locator('[aria-live="polite"]');
  }

  /** NPC message bubbles (left-aligned, base-100). */
  get npcBubbles() {
    return this.page.locator('[data-testid="dialogue-overlay"] .rounded-bl-md.bg-base-100');
  }

  /** Player message bubbles (right-aligned, primary). */
  get playerBubbles() {
    return this.page.locator('[data-testid="dialogue-overlay"] .rounded-br-md.bg-primary');
  }

  /** The streamError banner (rendered with .bg-error/10). */
  get errorBanner() {
    return this.page.locator('[data-testid="dialogue-overlay"] .bg-error\\/10');
  }

  /** The d20 interactive roll button (GameDice). */
  get d20RollButton() {
    return this.page.getByRole('button', { name: 'Click to roll d20' });
  }

  /** The dice overlay panel (GameDice). */
  get diceOverlay() {
    return this.page.locator('.dice-overlay');
  }

  // ── Actions ───────────────────────────────────────────────

  /** Sends a free-text message and returns immediately (streaming starts). */
  async sendMessage(text: string): Promise<void> {
    await this.input.fill(text);
    // Mount-race guard: let the fill propagate into viewModel.inputText
    // (oninput → setInput) before submitting.
    await this.page.waitForTimeout(100);
    await this.sendButton.click();
  }

  /** Clicks End Chat — aborts any in-flight generation (AC-3). */
  async endChat(): Promise<void> {
    await this.endChatButton.click();
  }

  /** Clicks the cancel (■) button while streaming (AC-3). */
  async cancelStreaming(): Promise<void> {
    await this.cancelButton.click();
  }

  /**
   * Rolls the interactive d20: first click acknowledges the DC declaration,
   * second click rolls. Used by the AC-2 skill-check flow.
   */
  async rollDice(): Promise<void> {
    const button = this.d20RollButton;
    await button.click();
    await this.page.waitForTimeout(100);
    await this.d20RollButton.click();
  }

  // ── Assertions / state reads ──────────────────────────────

  /** Asserts the dialogue overlay is visible. */
  async expectDialogueVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.overlay).toBeVisible({ timeout: 10_000 });
  }

  /** Reads the current length of the streamed narrative text. */
  async getStreamingTextLength(): Promise<number> {
    const text = await this.streamingRegion.textContent().catch(() => '');
    return (text ?? '').length;
  }

  /** Waits until at least one streamed token is visible. */
  async waitForStreamingStarted(): Promise<void> {
    await this.streamingRegion.first().waitFor({ state: 'visible', timeout: 5_000 });
  }

  /** Asserts no error banner is rendered (AC-3: no error surfaced). */
  async expectNoError(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.errorBanner).toHaveCount(0);
  }

  /** Asserts the timeout error banner is visible (AC-4). */
  async expectTimeoutError(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.errorBanner).toBeVisible({ timeout: 5_000 });
    await expect(this.errorBanner).toContainText('did not respond in time');
  }

  /** Asserts a given text appears in a settled NPC bubble. */
  async expectNpcText(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.npcBubbles.filter({ hasText: text }).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  /** Asserts the player message bubble is present. */
  async expectPlayerMessage(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.playerBubbles.filter({ hasText: text }).first()).toBeVisible({
      timeout: 5_000,
    });
  }

  /** Returns the number of NPC bubbles currently rendered. */
  async countNpcBubbles(): Promise<number> {
    return this.npcBubbles.count();
  }
}
