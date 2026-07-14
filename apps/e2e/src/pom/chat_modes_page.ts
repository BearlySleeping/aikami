// apps/e2e/src/pom/chat_modes_page.ts
// Page Object Model — ChatModesPage
//
// Encapsulates locators and interaction primitives for the Chat Modes
// address system dev sandbox (/dev/chat-modes). Covers address mode
// toggle, impersonation drafting, and party chat controls.
//
// Contract: C-241 Chat Modes Address System

import type { Page } from '@playwright/test';

/**
 * Page Object Model for the Chat Modes dev sandbox.
 */
export class ChatModesPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /** Navigate to the chat modes sandbox. */
  async goto(): Promise<void> {
    await this.page.goto('/dev/chat-modes');
    await this._waitForHydration();
  }

  /** Wait for the sandbox view to finish hydrating. */
  private async _waitForHydration(): Promise<void> {
    await this.page.waitForTimeout(1500);
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('heading', { name: '/dev/chat-modes' })).toBeVisible({
      timeout: 10000,
    });
  }

  // ── Locators ─────────────────────────────────────────────

  /** The chat message input textarea. */
  get chatInput() {
    return this.page.getByPlaceholder(/Type your message/);
  }

  /** The Send button. */
  get sendButton() {
    return this.page.locator('button:has-text("Send")');
  }

  /** The 🎭 impersonate quick button (visible when enabled). */
  get impersonateQuickButton() {
    return this.page.locator('button[title="Draft as your persona"]');
  }

  /** The 🎭 Impersonate toggle checkbox in chat settings. */
  get impersonateToggle() {
    return this.page.locator('label:has-text("🎭 Impersonate") input[type="checkbox"]');
  }

  /** The Stream TTS toggle checkbox. */
  get streamingTtsToggle() {
    return this.page.locator('label:has-text("Streaming TTS") input[type="checkbox"]');
  }

  /** The Scene address mode button. */
  get sceneModeButton() {
    return this.page.locator('button:has-text("Scene")');
  }

  /** The Party address mode button. */
  get partyModeButton() {
    return this.page.locator('button:has-text("Party")');
  }

  /** The GM address mode button. */
  get gmModeButton() {
    return this.page.locator('button:has-text("GM")');
  }

  /** The Push Story button. */
  get pushStoryButton() {
    return this.page.locator('button:has-text("Push Story")');
  }

  /** The NPC name heading. */
  get npcHeading() {
    return this.page.locator('h2:has-text("Chat with")');
  }

  // ── Actions ──────────────────────────────────────────────

  /** Type a message and press Enter. */
  async sendMessage(text: string): Promise<void> {
    const input = this.chatInput;
    await input.fill(text);
    await input.press('Enter');
  }

  /** Click the 🎭 impersonate quick button. */
  async clickImpersonateQuickButton(): Promise<void> {
    await this.impersonateQuickButton.click();
    await this.page.waitForTimeout(500);
  }

  /** Toggle the 🎭 Impersonate checkbox on. */
  async enableImpersonateQuickButton(): Promise<void> {
    const toggle = this.impersonateToggle;
    const isChecked = await toggle.isChecked();
    if (!isChecked) {
      await toggle.click();
      await this.page.waitForTimeout(300);
    }
  }

  /** Click the Send button. */
  async clickSend(): Promise<void> {
    await this.sendButton.click();
  }

  /** Click the Party mode button. */
  async selectPartyMode(): Promise<void> {
    await this.partyModeButton.click();
  }

  /** Click the GM mode button. */
  async selectGmMode(): Promise<void> {
    await this.gmModeButton.click();
  }

  /** Click the Scene mode button. */
  async selectSceneMode(): Promise<void> {
    await this.sceneModeButton.click();
  }

  // ── Slash command autocomplete ──────────────────────────

  /** The autocomplete popup container. */
  get autocompleteMenu() {
    return this.page.locator('[data-testid="slash-autocomplete-menu"]');
  }

  /** All autocomplete menu items. */
  get autocompleteItems() {
    return this.autocompleteMenu.locator('li button');
  }

  /** Get the raw textarea value. */
  async getInputValue(): Promise<string> {
    return this.chatInput.inputValue();
  }

  // ── Assertions ───────────────────────────────────────────

  /** Assert the autocomplete popup is visible. */
  async expectAutocompleteVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.autocompleteMenu).toBeVisible({ timeout: 2000 });
  }

  /** Assert the autocomplete popup is NOT visible. */
  async expectAutocompleteHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.autocompleteMenu).not.toBeVisible({ timeout: 2000 });
  }

  /** Assert a specific completion item is visible by its command text. */
  async expectCompletionVisible(commandName: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    // Each button has <span class="font-mono font-bold">/roll</span>
    await expect(
      this.autocompleteMenu.locator(`span.font-mono:has-text("/${commandName}")`),
    ).toBeVisible({ timeout: 2000 });
  }

  // ── Assertions ───────────────────────────────────────────

  /** Assert a message is visible in the chat. */
  async expectMessageVisible(text: string, timeout = 10_000): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(text)).toBeVisible({ timeout });
  }

  /** Assert the chat input contains the given text. */
  async expectInputContains(text: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.chatInput).toHaveValue(text);
  }

  /** Assert the impersonate quick button is visible. */
  async expectImpersonateButtonVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.impersonateQuickButton).toBeVisible();
  }

  /** Assert the address mode toggle is visible. */
  async expectAddressModeToggleVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.sceneModeButton).toBeVisible();
    await expect(this.partyModeButton).toBeVisible();
    await expect(this.gmModeButton).toBeVisible();
  }
}
