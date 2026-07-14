// apps/e2e/tests/client/sandboxes.spec.ts
// C-110: Sandbox E2E Testing — validates the DevViewModel + DevToolsPanel architecture.
//
// Each test navigates to a /dev/* sandbox route, clicks a DevToolsPanel action button,
// and asserts a visible UI change driven by the DevViewModel's mock state manipulation.

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Clicks a DevToolsPanel action button by its data-testid and waits
 * for Svelte 5 $effect DOM updates to flush.
 */
const clickDevAction = async (page: import('@playwright/test').Page, slug: string) => {
  const button = page.locator(`[data-testid="dev-action-${slug}"]`);
  await expect(button).toBeVisible();
  await button.click();
  // Allow Svelte 5 $effect + setTimeout callbacks to flush
  await page.waitForTimeout(800);
};

// ── Character Sandbox ────────────────────────────────────────────────────

test.describe('Character Sandbox (/dev/character)', () => {
  test('should load the character dev sandbox with mock chat messages', async ({ authUser }) => {
    const response = await authUser.goto('/dev/character');
    expect(response?.status()).toBe(200);

    // DevToolsPanel should be present
    await expect(authUser.locator('[data-testid="dev-action-force-error-state"]')).toBeVisible();

    // Character view container should render
    await expect(authUser.locator('[data-testid="PersonaCreateDevViewModel"]')).toBeVisible();
  });

  test('should react to Force Error State action', async ({ authUser }) => {
    await authUser.goto('/dev/character');
    await authUser.waitForTimeout(1000);

    // Click Force Error State — resets phase to CHAT, clears persona
    await clickDevAction(authUser, 'force-error-state');

    // After force error, the PersonaCreateDevViewModel container should still be mounted
    await expect(authUser.locator('[data-testid="PersonaCreateDevViewModel"]')).toBeVisible();

    // The chat phase UI should be visible (chat messages from mock init)
    const chatBubble = authUser.locator('.chat-bubble').first();
    await expect(chatBubble).toBeVisible();
  });
});

// ── Chat Sandbox ─────────────────────────────────────────────────────────

test.describe('Chat Sandbox (/dev/chat)', () => {
  test('should load the chat dev sandbox with NPC card and seed messages', async ({ authUser }) => {
    const response = await authUser.goto('/dev/chat');
    expect(response?.status()).toBe(200);

    // NPC name should be visible in the chat title
    await expect(authUser.getByText('Chat with Eldrin Starweaver')).toBeVisible();

    // DevToolsPanel should be present
    await expect(authUser.locator('[data-testid="dev-action-simulate-bot-reply"]')).toBeVisible();
  });

  test('should inject a bot reply via Simulate Bot Reply action', async ({ authUser }) => {
    await authUser.goto('/dev/chat');
    await authUser.waitForTimeout(2000);

    // Click Simulate Bot Reply — injects a mock AI response with streaming delay
    await clickDevAction(authUser, 'simulate-bot-reply');

    // Wait for the streaming simulation to complete (1.2s setTimeout + buffer)
    await authUser.waitForTimeout(1500);

    const botMessage = authUser.locator('.chat-message, [class*="chat-bubble"]').filter({
      hasText: /stars|constellation|prophecy|Shadowmere|observatory/,
    });
    await expect(botMessage.first()).toBeVisible({ timeout: 5000 });
  });
});

// ── Combat Sandbox ───────────────────────────────────────────────────────

test.describe('Combat Sandbox (/dev/combat)', () => {
  test('should load the combat dev sandbox with mock HP values', async ({ authUser }) => {
    const response = await authUser.goto('/dev/combat');
    expect(response?.status()).toBe(200);

    // Player HP is shown in the sidebar HP card (compact HP bars)
    // The HP values are displayed as spans inside the compact HP card
    await expect(authUser.locator('.grid.grid-cols-2 .rounded')).toHaveCount(2);

    // DevToolsPanel should be present
    await expect(authUser.locator('[data-testid="dev-action-force-player-hp-to-1"]')).toBeVisible();
  });

  test('should update player HP to 1 via Force Player HP to 1 action', async ({ authUser }) => {
    await authUser.goto('/dev/combat');
    await authUser.waitForTimeout(1000);

    // Click Force Player HP to 1
    await clickDevAction(authUser, 'force-player-hp-to-1');

    // Player HP should now show 1/100 in the sidebar
    const playerHpRegion = authUser.locator('.grid.grid-cols-2 .rounded').first();
    await expect(playerHpRegion).toContainText('1/');
  });
});

// ── Inventory Sandbox ────────────────────────────────────────────────────

test.describe('Inventory Sandbox (/dev/inventory)', () => {
  test('should load the inventory dev sandbox with mock items', async ({ authUser }) => {
    const response = await authUser.goto('/dev/inventory');
    expect(response?.status()).toBe(200);

    // Click "Open Inventory" to show the overlay
    await authUser.getByRole('button', { name: 'Open Inventory' }).click();

    // Inventory card should now be visible
    await expect(authUser.locator('h2:has-text("Inventory")')).toBeVisible();

    // DevToolsPanel should be present
    await expect(authUser.locator('[data-testid="dev-action-fill-with-junk"]')).toBeVisible();
  });

  test('should fill inventory with junk items via Fill with Junk action', async ({ authUser }) => {
    await authUser.goto('/dev/inventory');

    // Click "Open Inventory" to show the overlay
    await authUser.getByRole('button', { name: 'Open Inventory' }).click();

    // Initially shows empty state
    await expect(authUser.getByText('No items collected yet')).toBeVisible();

    // Click Fill with Junk — populates inventory up to max capacity
    await clickDevAction(authUser, 'fill-with-junk');

    // After filling, the empty message should be gone
    await expect(authUser.getByText('No items collected yet')).not.toBeVisible();

    // Junk items should now be visible in the inventory card
    await expect(authUser.getByText('rusty-sword').first()).toBeVisible();
    await expect(authUser.getByText('old-boot').first()).toBeVisible();
  });
});

// ── Quest Sandbox ────────────────────────────────────────────────────────

test.describe('Quest Sandbox (/dev/quest)', () => {
  test('should load the quest dev sandbox with auto-injected mock quests', async ({ authUser }) => {
    const response = await authUser.goto('/dev/quest');
    expect(response?.status()).toBe(200);

    // Active quests should be auto-injected on initialize (3 active)
    const activeHeader = authUser.locator('[data-testid="active-quests-header"]');
    await expect(activeHeader).toBeVisible();
    await expect(activeHeader).toContainText('Active (3)');

    // Quest cards should be rendered
    await expect(authUser.getByText('Slime Extermination')).toBeVisible();
    await expect(authUser.getByText('Gather Moonpetal Herbs')).toBeVisible();
    await expect(authUser.getByText('Explore the Crystal Caverns')).toBeVisible();

    // DevToolsPanel should be present
    await expect(authUser.locator('[data-testid="dev-action-inject-mock-quests"]')).toBeVisible();
  });

  test('should re-inject mock quests via Inject Mock Quests action', async ({ authUser }) => {
    await authUser.goto('/dev/quest');
    await authUser.waitForTimeout(1000);

    // First, fail a random quest to change state
    await clickDevAction(authUser, 'fail-random-quest');

    // Active count should decrease (one quest moved to failed)
    const activeHeader = authUser.locator('[data-testid="active-quests-header"]');
    await expect(activeHeader).toContainText('Active (2)');

    // Now re-inject mock quests — resets to full state
    await clickDevAction(authUser, 'inject-mock-quests');

    // Active count should be back to 3
    await expect(activeHeader).toContainText('Active (3)');
  });
});
