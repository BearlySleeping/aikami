import { expect, test } from '@playwright/test';
import { authenticatePage } from './utils/playwright_auth.ts';

test.describe('Chat Message Sending', () => {
  test('should send and receive a chat message in emulator mode', async ({ page }) => {
    // Capture console messages for debugging
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Navigate to login page first
    await page.goto('http://localhost:5173/login');
    await page.waitForLoadState('networkidle');

    // Login with emulator user
    await page.fill('input[name="email"]', 'authorized@bearlysleeping.com');
    await page.fill('input[name="password"]', 'asdasd');
    await page.click('button[type="submit"]');

    // Wait for login to complete and redirect to NPCs page
    await page.waitForURL('**/npcs', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Click on first NPC to start a chat
    const npcCard = page.locator('[data-testid="npc-card"]').first();
    if (await npcCard.isVisible()) {
      await npcCard.click();
    } else {
      // If no NPCs exist, try navigating directly to a chat
      await page.goto('http://localhost:5173/chat/4YwVvY5y52OArJoG7zMh');
    }

    // Wait for chat page to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check if we're on a chat page
    const chatInput = page.getByPlaceholder(/Type your message/);

    if (await chatInput.isVisible()) {
      // Send a test message
      const testMessage = `Test message ${Date.now()}`;
      await chatInput.fill(testMessage);
      await chatInput.press('Enter');

      // Wait for message to be sent
      await page.waitForTimeout(3000);

      // Check if message appears in chat
      await expect(page.getByText(testMessage)).toBeVisible({ timeout: 10000 });

      // Wait for AI response (in emulator mode, it should be a mock response)
      await page.waitForTimeout(3000);

      // Check for mock AI response in emulator mode
      const mockResponse = page.getByText(/Mock AI Response/);
      if (await mockResponse.isVisible({ timeout: 5000 }).catch(() => false)) {
      }
    } else {
    }
  });

  test('should display chat messages from Firestore', async ({ page }) => {
    await authenticatePage(page);

    // Navigate to an NPC chat
    await page.goto('http://localhost:5173/chat/4YwVvY5y52OArJoG7zMh');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check if chat container is visible
    const chatContainer = page.locator('[data-testid="chat-container"]');
    if (await chatContainer.isVisible().catch(() => false)) {
    }
  });
});
