import { expect, test } from '@playwright/test';

test.describe('PWA', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Aikami/);
  });

  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Login')).toBeVisible();
  });

  test('should show register page for unauthenticated users', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('text=Register')).toBeVisible();
  });

  test('should navigate between public pages', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Login')).toBeVisible();

    await page.click('text=Register');
    await expect(page.locator('text=Register')).toBeVisible();
  });
});
