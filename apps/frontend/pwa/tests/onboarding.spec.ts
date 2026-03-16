import { expect, test } from '@playwright/test';
import { authenticateAndGo, authenticatePage } from './utils/playwright-auth.ts';

test.describe('Onboarding Flow', () => {
  test('new user without personas should be redirected to onboarding', async ({ page }) => {
    await authenticateAndGo(page, '/dashboard');

    await expect(page).toHaveURL(/\/personas\/create\?onboarding=true/);
  });

  test('onboarding page shows welcome message', async ({ page }) => {
    await authenticateAndGo(page, '/personas/create?onboarding=true');

    await expect(page.getByText('Welcome to AI RPG')).toBeVisible();
    await expect(
      page.getByText('Create your first character to begin your adventure'),
    ).toBeVisible();
  });

  test('onboarding page has skip button', async ({ page }) => {
    await authenticateAndGo(page, '/personas/create?onboarding=true');

    await expect(page.getByRole('button', { name: /skip for now/i })).toBeVisible();
  });

  test('skip onboarding redirects to dashboard', async ({ page }) => {
    await authenticateAndGo(page, '/personas/create?onboarding=true');

    await page.getByRole('button', { name: /skip for now/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('non-onboarding persona creation does not show skip button', async ({ page }) => {
    await authenticateAndGo(page, '/personas/create');

    await expect(page.getByText('Welcome to AI RPG')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /skip for now/i })).not.toBeVisible();
  });
});

test.describe('Authenticated Navigation', () => {
  test('authenticated user can access dashboard', async ({ page }) => {
    await authenticateAndGo(page, '/dashboard');

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('authenticated user can access personas page', async ({ page }) => {
    await authenticateAndGo(page, '/personas');

    await expect(page).toHaveURL(/\/personas/);
  });

  test('authenticated user can access group chats page', async ({ page }) => {
    await authenticateAndGo(page, '/group-chats');

    await expect(page).toHaveURL(/\/group-chats/);
  });
});
