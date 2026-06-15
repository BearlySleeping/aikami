// apps/e2e/tests/client/boot_diagnostics_visual.spec.ts
// Visual Regression Test — verifies the boot diagnostics terminal renders
// correctly in both "Both Online" and "Both Offline" states.
//
// Contract: C-130 In-Game AI Diagnostics & Onboarding
//
// Uses the client-visual Playwright project (no auth, no Firebase).

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

// ── Test 1: Both providers offline ─────────────────────────────────────

test('boot diagnostics terminal — both providers offline', async ({ page }) => {
  // Mock both provider pings to return errors (offline state)
  await page.route('**/localhost:11434/**', (route) => {
    route.abort('connectionrefused');
  });

  await page.route('**/localhost:8188/**', (route) => {
    route.abort('connectionrefused');
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the boot diagnostics terminal to render
  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });

  // Both status labels should show OFFLINE
  await expect(page.locator('text=OFFLINE')).toHaveCount(2);

  // The Initialize Core button should be disabled
  const bootButton = page.locator('button:has-text("Awaiting Providers")');
  await expect(bootButton).toBeDisabled();

  // Offline instructions should be visible for both providers
  await expect(page.locator('text=Awaiting connection')).toHaveCount(2);
  await expect(page.locator('text=ollama serve')).toBeVisible();
  await expect(page.locator('text=python main.py')).toBeVisible();

  // Capture golden snapshot
  await expect(page).toHaveScreenshot('boot-diagnostics-offline.png', {
    fullPage: true,
  });
});

// ── Test 2: Both providers online ──────────────────────────────────────

test('boot diagnostics terminal — both providers online', async ({ page }) => {
  // Mock both provider pings to return 200 OK
  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Ollama is running',
    });
  });

  await page.route('**/localhost:8188/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ system: { cpu: 'ok', memory: 'ok' } }),
    });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the boot diagnostics terminal to render
  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });

  // Wait for the status indicators to update (polling happens immediately)
  await expect(page.locator('text=ONLINE')).toHaveCount(2, { timeout: 10_000 });

  // The Initialize Core button should be enabled
  const bootButton = page.locator('button:has-text("Initialize Core")');
  await expect(bootButton).toBeEnabled();

  // No offline instructions should be visible
  await expect(page.locator('text=Awaiting connection')).toHaveCount(0);

  // Capture golden snapshot
  await expect(page).toHaveScreenshot('boot-diagnostics-online.png', {
    fullPage: true,
  });
});

// ── Test 3: Transition from offline to online ──────────────────────────

test('boot diagnostics terminal — transitions from offline to online', async ({ page }) => {
  // Start with both providers offline
  await page.route('**/localhost:11434/**', (route) => {
    route.abort('connectionrefused');
  });

  await page.route('**/localhost:8188/**', (route) => {
    route.abort('connectionrefused');
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });
  await expect(page.locator('text=OFFLINE')).toHaveCount(2, { timeout: 5_000 });

  // Now switch mocks to online (simulating user starting the services)
  await page.unroute('**/localhost:11434/**');
  await page.unroute('**/localhost:8188/**');

  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({
      status: 200,
      body: 'Ollama is running',
    });
  });

  await page.route('**/localhost:8188/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ system: { cpu: 'ok', memory: 'ok' } }),
    });
  });

  // The polling interval (3s) should pick up the change
  await expect(page.locator('text=ONLINE')).toHaveCount(2, { timeout: 15_000 });

  // Button should now be enabled
  const bootButton = page.locator('button:has-text("Initialize Core")');
  await expect(bootButton).toBeEnabled();
});
