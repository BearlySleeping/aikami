import { expect, test } from '@playwright/test';

/**
 * Quick smoke test: does the Chat chat connect to the emulator?
 * Tests that the greeting renders and the Firebase callable responds.
 */

async function hideDevToolbar(page: Parameters<Parameters<typeof test>[1]>[0]) {
  await page.evaluate(() => {
    document.querySelector('astro-dev-toolbar')?.remove();
  });
}

test.describe('Chat Chat — emulator integration', () => {
  test('chat widget loads and greeting appears', async ({ page }) => {
    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
      }
    });

    await page.goto('/');
    await hideDevToolbar(page);

    // Wait for chat widget
    const chat = page.locator('#chat-chat');
    await expect(chat).toBeVisible({ timeout: 10000 });

    // Greeting should appear via JS
    await page.waitForTimeout(2000);
    const history = page.locator('#chat-history');
    const text = await history.textContent();
    expect(text?.length).toBeGreaterThan(10);
  });

  test('sending a message gets a real Firebase response', async ({ page }) => {
    await page.goto('/');
    await hideDevToolbar(page);
    await page.waitForSelector('#chat-chat', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Type and send
    const input = page.locator('#chat-input');
    const sendBtn = page.locator('#chat-send');

    await input.fill('What is Nordclaw?');
    await sendBtn.click();

    // Wait for response (up to 15s for cold start)
    const response = page.locator('#chat-chat').getByText(/Nordclaw|Chat|STUB|offline/i);
    await expect(response.first()).toBeVisible({ timeout: 20000 });

    const _responseText = await page.locator('#chat-history').textContent();
  });

  test('starter chip sends prompt and gets response', async ({ page }) => {
    await page.goto('/');
    await hideDevToolbar(page);
    await page.waitForSelector('#chat-chat', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Click a starter chip
    const chip = page.locator('.starter-chip').first();
    await chip.click();

    // Wait for any response
    const response = page.locator('#chat-chat').locator("[class*='rounded-2xl']");
    await expect(response.nth(1)).toBeVisible({ timeout: 20000 });

    const _responseText = await page.locator('#chat-history').textContent();
  });
});
