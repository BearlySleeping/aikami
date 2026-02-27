import { expect, test } from '@playwright/test';

test.describe('CharacterCard Component', () => {
  test('should render character name', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.getByRole('heading', { name: 'Test NPC' })).toBeVisible();
  });

  test('should render character avatar when provided', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.locator('.avatar img')).toBeVisible();
  });

  test('should render character class and level', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.getByText(/Warrior/)).toBeVisible();
    await expect(page.getByText(/Level 5/)).toBeVisible();
  });

  test('should render personality traits', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.getByText(/Brave and noble/)).toBeVisible();
  });

  test('should show greeting message when provided', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.getByText(/Greetings, traveler!/)).toBeVisible();
  });

  test('should show Start Chat button when notes exist', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.getByRole('button', { name: 'Start Chat' })).toBeVisible();
  });

  test('should hide Start Chat button when no notes', async ({ page }) => {
    await page.goto('/chat/test-no-notes');
    await expect(page.getByRole('button', { name: 'Start Chat' })).not.toBeVisible();
  });
});

test.describe('TypingIndicator Component', () => {
  test('should show typing indicator when isTyping is true', async ({ page }) => {
    await page.goto('/chat/test-id');
    const input = page.getByPlaceholder(/Type your message/);
    await input.fill('Test message');
    await input.press('Enter');
    await expect(page.getByText(/is typing/)).toBeVisible();
  });

  test('should not show typing indicator initially', async ({ page }) => {
    await page.goto('/chat/test-id');
    await expect(page.getByText(/is typing/)).not.toBeVisible();
  });
});
