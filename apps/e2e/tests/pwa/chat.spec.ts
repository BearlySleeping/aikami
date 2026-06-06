import { expect, test } from '@playwright/test';

test.describe('Chat Components', () => {
  test.describe('ChatContainer', () => {
    test('should render chat container with title', async ({ page }) => {
      await page.goto('/chat/test-id');
      await expect(page.getByRole('heading', { name: /Chat with/i })).toBeVisible();
    });

    test('should show empty state when no messages', async ({ page }) => {
      await page.goto('/chat/test-id');
      await expect(page.getByText('No messages yet. Start the conversation!')).toBeVisible();
    });

    test('should render message input', async ({ page }) => {
      await page.goto('/chat/test-id');
      await expect(page.getByPlaceholder(/Type your message/)).toBeVisible();
    });

    test('should have send button', async ({ page }) => {
      await page.goto('/chat/test-id');
      await expect(page.getByRole('button')).toBeVisible();
    });
  });

  test.describe('ChatInput', () => {
    test('should update input value when typing', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('Hello world');
      await expect(input).toHaveValue('Hello world');
    });

    test('should send message on Enter key', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('Test message');
      await input.press('Enter');
      await expect(page.getByText('Test message')).toBeVisible();
    });

    test('should not send empty message', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.press('Enter');
      await expect(page.getByText('No messages yet')).toBeVisible();
    });

    test('should disable input when sending', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('Test');
      await input.press('Enter');
      await expect(input).toBeDisabled();
    });
  });

  test.describe('ChatMessage', () => {
    test('should display user message on right side', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('User message');
      await input.press('Enter');
      await expect(page.getByText('User message')).toBeVisible();
      await expect(page.getByText('You')).toBeVisible();
    });

    test('should display AI message on left side', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('Hello AI');
      await input.press('Enter');
      await page.waitForTimeout(500);
      await expect(page.getByText('AI')).toBeVisible();
    });

    test('should show timestamp', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('Test');
      await input.press('Enter');
      await expect(page.getByText(/\d{1,2}:\d{2}/)).toBeVisible();
    });
  });

  test.describe('Loading States', () => {
    test('should show loading spinner during initial load', async ({ page }) => {
      await page.goto('/chat/test-id');
      const spinner = page.locator('.loading-spinner');
      await expect(spinner).toBeVisible({ timeout: 10000 });
    });

    test('should show sending spinner when sending message', async ({ page }) => {
      await page.goto('/chat/test-id');
      const input = page.getByPlaceholder(/Type your message/);
      await input.fill('Test message');
      await input.press('Enter');
      await expect(page.locator('.loading-spinner')).toBeVisible();
    });
  });
});
