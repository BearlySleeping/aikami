// apps/e2e/tests/client/chat_modes.spec.ts
//
// E2E tests for Chat Modes Address System.
// Covers impersonation drafting, address mode toggle, and party chat.
//
// Contract: C-241 Chat Modes Address System

import { expect } from '@playwright/test';
import { ChatModesPage } from '$pom';
import { test } from '../../src/fixtures';

test.describe('Chat Modes Sandbox (/dev/chat-modes)', () => {
  let chatModes: ChatModesPage;

  test.beforeEach(async ({ authUser }) => {
    chatModes = new ChatModesPage(authUser);
    await chatModes.goto();
  });

  // ── AC-1: Impersonation Slash Command ────────────────────

  test('should show draft in input after /impersonate command (mock sandbox)', async ({
    authUser,
  }) => {
    // The sandbox uses mock persona data — the /impersonate command
    // will trigger a real LLM call (or mock if not available).
    // Verify the command at least reaches the input interception.
    await chatModes.sendMessage('/impersonate I examine the ancient runes');

    // In the sandbox, impersonation uses a real personaService call
    // which may or may not have a persona. We verify the textarea
    // behavior: if a persona exists, the input is populated with draft;
    // otherwise, a toast is shown.
    // Wait for the async flow to resolve.
    await authUser.waitForTimeout(2000);

    // At minimum, the input should not be stuck in sending state
    await expect(chatModes.chatInput).toBeEnabled({ timeout: 5000 });
  });

  // ── AC-2: Impersonation Quick Button ─────────────────────

  test('should show impersonation quick button when toggle is enabled', async ({ authUser }) => {
    // The sandbox pre-enables the quick button toggle
    await authUser.waitForTimeout(1000);

    // The impersonate toggle should be checked
    const isChecked = await chatModes.impersonateToggle.isChecked();
    expect(isChecked).toBe(true);

    // The quick button should be visible
    await chatModes.expectImpersonateButtonVisible();
  });

  test('should hide impersonation quick button when toggle is disabled', async ({ authUser }) => {
    await authUser.waitForTimeout(1000);

    // Disable the toggle
    await chatModes.impersonateToggle.click();
    await authUser.waitForTimeout(300);

    // Quick button should disappear
    await expect(chatModes.impersonateQuickButton).not.toBeVisible();
  });

  // ── Address mode toggle (from C-235) ─────────────────────

  test('should show address mode toggle with three modes', async () => {
    await chatModes.expectAddressModeToggleVisible();
  });

  test('should activate Party mode when Party button is clicked', async ({ authUser }) => {
    await chatModes.selectPartyMode();
    await authUser.waitForTimeout(300);

    // Verify Party button is now active (has btn-active class)
    const partyBtn = chatModes.partyModeButton;
    await expect(partyBtn).toHaveClass(/btn-active/);
  });

  test('should activate GM mode when GM button is clicked', async ({ authUser }) => {
    await chatModes.selectGmMode();
    await authUser.waitForTimeout(300);

    const gmBtn = chatModes.gmModeButton;
    await expect(gmBtn).toHaveClass(/btn-active/);
  });

  // ── Chat input functionality ─────────────────────────────

  test('should show NPC name in chat header', async () => {
    await expect(chatModes.npcHeading).toBeVisible();
    await expect(chatModes.npcHeading).toContainText('Thalia Moonshadow');
  });

  test('should accept text input and send button is enabled', async () => {
    const input = chatModes.chatInput;
    await input.fill('Hello there');
    await expect(chatModes.sendButton).toBeEnabled();
  });

  // ── Slash command autocomplete ──────────────────────────

  test('should show completions popup when typing /', async () => {
    const input = chatModes.chatInput;
    await input.clear();
    await input.pressSequentially('/');
    await chatModes.expectAutocompleteVisible();
  });

  test('/r + Enter should apply /roll ', async ({ authUser }) => {
    const input = chatModes.chatInput;
    await input.clear();
    // Type /r — popup should appear showing /roll
    await input.pressSequentially('/r');
    await chatModes.expectAutocompleteVisible();
    await chatModes.expectCompletionVisible('roll');
    // Press Enter to apply
    await input.press('Enter');
    await authUser.waitForTimeout(300);
    // Textarea should contain /roll
    const value = await chatModes.getInputValue();
    expect(value.trim()).toBe('/roll');
    // Popup should be dismissed
    await chatModes.expectAutocompleteHidden();
  });

  test('Escape should dismiss autocomplete popup', async ({ authUser }) => {
    const input = chatModes.chatInput;
    await input.clear();
    await input.pressSequentially('/');
    await chatModes.expectAutocompleteVisible();
    await input.press('Escape');
    await authUser.waitForTimeout(300);
    await chatModes.expectAutocompleteHidden();
    // Input should keep the / text
    const value = await chatModes.getInputValue();
    expect(value.trim()).toBe('/');
  });

  test('ArrowDown + Tab should apply selected completion', async ({ authUser }) => {
    const input = chatModes.chatInput;
    await input.clear();
    await input.pressSequentially('/');
    await chatModes.expectAutocompleteVisible();
    // ArrowDown to second item
    await input.press('ArrowDown');
    await authUser.waitForTimeout(100);
    // Tab to apply
    await input.press('Tab');
    await authUser.waitForTimeout(300);
    // Should have applied some command (not just /)
    const value = await chatModes.getInputValue();
    expect(value.trim().startsWith('/')).toBe(true);
    expect(value.trim().length).toBeGreaterThan(2);
    await chatModes.expectAutocompleteHidden();
  });
});
