// apps/e2e/src/pom/pwa_chat_page.ts
// Page Object Model — PwaChatPage
//
// Encapsulates locators and interaction primitives for the PWA Chat interface.
// Handles chat message submission, streaming state detection, and character
// card verification.

import type { Page } from '@playwright/test';

/**
 * Page Object Model for PWA Chat and Character Card interactions.
 *
 * Wraps Playwright `Page` and exposes chat-interaction, message-assertion,
 * and character-card methods required by the PWA E2E suites.
 */
export class PwaChatPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────

  /**
   * Navigate to a chat page for a specific NPC ID.
   */
  async gotoChat(chatId: string): Promise<void> {
    await this.page.goto(`/chat/${chatId}`);
    await this._waitForHydration();
  }

  // ── Chat Input ────────────────────────────────────────────

  /**
   * Get the chat message input locator.
   */
  getMessageInput() {
    return this.page.getByPlaceholder(/Type your message/);
  }

  /**
   * Type a message into the chat input and press Enter to send.
   *
   * @param message  The message text to send.
   */
  async sendMessage(message: string): Promise<void> {
    const input = this.getMessageInput();
    await input.fill(message);
    await input.press('Enter');
  }

  /**
   * Assert the chat input is visible.
   */
  async expectInputVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.getMessageInput()).toBeVisible();
  }

  /**
   * Assert the chat input is disabled (e.g., while sending).
   */
  async expectInputDisabled(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.getMessageInput()).toBeDisabled();
  }

  // ── Messages ──────────────────────────────────────────────

  /**
   * Assert a specific message text is visible in the chat.
   */
  async expectMessageVisible(text: string, timeout = 10_000): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(text)).toBeVisible({ timeout });
  }

  /**
   * Assert the "No messages yet" empty state is shown.
   */
  async expectEmptyState(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText('No messages yet. Start the conversation!')).toBeVisible();
  }

  /**
   * Assert the chat heading is visible for a given NPC name.
   */
  async expectHeading(name: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(
      this.page.getByRole('heading', { name: new RegExp(`Chat with ${name}`) }),
    ).toBeVisible();
  }

  // ── Character Card ────────────────────────────────────────

  /**
   * Assert the character card displays the character name.
   */
  async expectCharacterName(name: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('heading', { name })).toBeVisible();
  }

  /**
   * Assert the character avatar image is visible.
   */
  async expectAvatarVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.locator('.avatar img')).toBeVisible();
  }

  /**
   * Assert character class and level text is visible.
   */
  async expectClassAndLevel(className: string, level: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(new RegExp(className))).toBeVisible();
    await expect(this.page.getByText(new RegExp(`Level ${level}`))).toBeVisible();
  }

  /**
   * Assert personality traits text is visible.
   */
  async expectPersonality(traits: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(new RegExp(traits))).toBeVisible();
  }

  /**
   * Assert greeting message is visible.
   */
  async expectGreeting(greeting: string): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(new RegExp(greeting))).toBeVisible();
  }

  /**
   * Assert "Start Chat" button is visible.
   */
  async expectStartChatButton(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('button', { name: 'Start Chat' })).toBeVisible();
  }

  /**
   * Assert "Start Chat" button is NOT visible.
   */
  async expectStartChatButtonHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByRole('button', { name: 'Start Chat' })).not.toBeVisible();
  }

  // ── Typing Indicator ─────────────────────────────────────

  /**
   * Assert the typing indicator is visible.
   */
  async expectTypingIndicator(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(/is typing/)).toBeVisible();
  }

  /**
   * Assert the typing indicator is NOT visible.
   */
  async expectTypingIndicatorHidden(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.page.getByText(/is typing/)).not.toBeVisible();
  }

  // ── Internal ──────────────────────────────────────────────

  private async _waitForHydration(): Promise<void> {
    // The PWA uses SvelteKit SSR — wait for DOM to become interactive.
    // Note: The PWA does NOT set data-hydrated="true" on <html>.
    // Instead, wait for load state and a reasonable DOM element.
    await this.page.waitForLoadState('domcontentloaded');
  }
}
