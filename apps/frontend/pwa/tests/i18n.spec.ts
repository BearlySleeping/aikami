import { expect, test } from '@playwright/test';

test.describe('i18n Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show navigation drawer with translated labels', async ({ page }) => {
    await page.getByLabel('Open drawer').click();

    await expect(page.getByText('Home')).toBeVisible();
    await expect(page.getByText('Characters')).toBeVisible();
    await expect(page.getByText('Profile')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
  });

  test('should show logout button in navigation', async ({ page }) => {
    await page.getByLabel('Open drawer').click();

    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
  });

  test('should show app bar with translated title on settings page', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
});

test.describe('i18n Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should show translated login form labels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('should show translated buttons and links', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.getByRole('link', { name: "Don't have an account?" })).toBeVisible();
  });
});

test.describe('i18n Register Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('should show translated register form labels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sign Up' })).toBeVisible();
    await expect(page.getByLabel('Full Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});
