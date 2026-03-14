import { expect, test } from '@playwright/test';

test.describe('Login with Emulator', () => {
  test('should login with emulator user', async ({ page }) => {
    // Capture console messages
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Navigate to login page
    await page.goto('http://localhost:5173/login');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Fill in login form
    await page.fill('input[name="email"]', 'authorized@bearlysleeping.com');
    await page.fill('input[name="password"]', 'asdasd');

    // Click login button
    await page.click('button[type="submit"]');

    // Wait for navigation or error
    await page.waitForTimeout(3000);

    // Print console logs
    console.log('\n=== Console Logs ===');
    consoleLogs.forEach((log) => console.log(log));

    // Check current URL
    const currentUrl = page.url();
    console.log('\n=== Current URL ===');
    console.log(currentUrl);

    // Get any errors visible on page
    const errors = await page.locator('[role="alert"], .alert-error, .error').allTextContents();
    if (errors.length > 0) {
      console.log('\n=== Page Errors ===');
      errors.forEach((err) => console.log(err));
    }
  });
});
