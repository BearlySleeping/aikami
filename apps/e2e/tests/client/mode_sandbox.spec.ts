// apps/e2e/tests/client/mode_sandbox.spec.ts
//
// C-140: Game Mode System — E2E sandbox verification.
//
// Verifies that the `/dev/sandbox/mode` route loads, the mode indicator
// renders the current mode, and toggling modes via the control panel works.

import { expect, test } from '../../src/fixtures';

test.describe('Mode Sandbox (C-140)', () => {
  test('should load the mode sandbox page', async ({ guestUser }) => {
    await guestUser.goto('/dev/sandbox/mode');
    await guestUser.waitForLoadState('domcontentloaded');
  });

  test('should show EXPLORE mode indicator on load', async ({ guestUser }) => {
    await guestUser.goto('/dev/sandbox/mode');

    // Wait for the mode indicator to appear and show EXPLORE
    const modeBadge = guestUser.locator('.badge');
    await modeBadge.first().waitFor({ state: 'visible', timeout: 15000 });
    await guestUser.waitForTimeout(1000);

    const text = await modeBadge.first().textContent();
    expect(text?.trim()).toBe('EXPLORE');
  });

  test('should toggle to DIALOGUE mode via button click', async ({ guestUser }) => {
    await guestUser.goto('/dev/sandbox/mode');

    // Wait for the control panel buttons to appear
    const dialogueButton = guestUser.locator('button', { hasText: 'DIALOGUE' });
    await dialogueButton.waitFor({ state: 'visible', timeout: 15000 });
    await guestUser.waitForTimeout(1000);

    // Click the DIALOGUE button
    await dialogueButton.click();
    await guestUser.waitForTimeout(500);

    // Verify the mode indicator changed to DIALOGUE
    const modeBadge = guestUser.locator('.badge').first();
    const text = await modeBadge.textContent();
    expect(text?.trim()).toBe('DIALOGUE');
  });

  test('should toggle back to EXPLORE mode', async ({ guestUser }) => {
    await guestUser.goto('/dev/sandbox/mode');

    // Wait for buttons to appear
    const dialogueButton = guestUser.locator('button', { hasText: 'DIALOGUE' });
    const exploreButton = guestUser.locator('button', { hasText: 'EXPLORE' });
    await exploreButton.waitFor({ state: 'visible', timeout: 15000 });
    await guestUser.waitForTimeout(1000);

    // Switch to DIALOGUE
    await dialogueButton.click();
    await guestUser.waitForTimeout(300);

    // Switch back to EXPLORE
    await exploreButton.click();
    await guestUser.waitForTimeout(300);

    // Verify indicator shows EXPLORE
    const modeBadge = guestUser.locator('.badge').first();
    const text = await modeBadge.textContent();
    expect(text?.trim()).toBe('EXPLORE');
  });

  test('should show MENU mode when toggled', async ({ guestUser }) => {
    await guestUser.goto('/dev/sandbox/mode');

    const menuButton = guestUser.locator('button', { hasText: 'MENU' });
    await menuButton.waitFor({ state: 'visible', timeout: 15000 });
    await guestUser.waitForTimeout(1000);

    await menuButton.click();
    await guestUser.waitForTimeout(500);

    const modeBadge = guestUser.locator('.badge').first();
    const text = await modeBadge.textContent();
    expect(text?.trim()).toBe('MENU');
  });
});
