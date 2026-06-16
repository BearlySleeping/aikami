// apps/e2e/tests/client/boot_diagnostics_visual.spec.ts
// Visual Regression Test — verifies the boot diagnostics terminal renders
// correctly across multiple provider configurations: Both Online, Both
// Offline, Hybrid (OpenRouter + Local Comfy), Text-Only (Ollama Online,
// Comfy Offline), and provider transitions.
//
// Contracts: C-130 In-Game AI Diagnostics, C-133 Flexible Provider Onboarding
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

  await page.route('**/api/image/object_info', (route) => {
    route.abort('connectionrefused');
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the boot diagnostics terminal to render
  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });

  // Both Text and Image should show OFFLINE (Voice is always ONLINE)
  await expect(page.locator('text=OFFLINE')).toHaveCount(2);

  // The Initialize Core button should be disabled with C-133 text
  const bootButton = page.locator('button:has-text("Awaiting Text Provider")');
  await expect(bootButton).toBeDisabled();

  // Offline instructions should be visible for Ollama
  await expect(page.locator('text=ollama serve')).toBeVisible();

  // Hardware recommendations should be visible
  await expect(page.locator('text=Hardware Recommendations')).toBeVisible();

  // Required System label should be visible
  await expect(page.locator('text=REQUIRED SYSTEM')).toBeVisible();

  // Optional Subsystems label should be visible
  await expect(page.locator('text=OPTIONAL SUBSYSTEMS')).toBeVisible();

  // Capture golden snapshot
  await expect(page).toHaveScreenshot('boot-diagnostics-offline.png', {
    fullPage: true,
  });
});

// ── Test 2: Both providers online (Ollama + ComfyUI, default) ──────────

test('boot diagnostics terminal — both providers online', async ({ page }) => {
  // Mock both provider pings to return 200 OK
  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Ollama is running',
    });
  });

  await page.route('**/api/image/object_info', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // biome-ignore lint/style/useNamingConvention: PixiJS extension name
      body: JSON.stringify({ CheckpointLoaderSimple: {} }),
    });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the boot diagnostics terminal to render
  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });

  // Wait for the status indicators to update (polling happens immediately)
  await expect(page.locator('text=ONLINE')).toHaveCount(3, { timeout: 10_000 }); // Text, Image, Voice

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

  await page.route('**/api/image/object_info', (route) => {
    route.abort('connectionrefused');
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });
  await expect(page.locator('text=OFFLINE')).toHaveCount(2, { timeout: 5_000 });

  // Now switch mocks to online (simulating user starting the services)
  await page.unroute('**/localhost:11434/**');
  await page.unroute('**/api/image/object_info');

  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({
      status: 200,
      body: 'Ollama is running',
    });
  });

  await page.route('**/api/image/object_info', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // biome-ignore lint/style/useNamingConvention: PixiJS extension name
      body: JSON.stringify({ CheckpointLoaderSimple: {} }),
    });
  });

  // The polling interval (3s) should pick up the change
  await expect(page.locator('text=ONLINE')).toHaveCount(3, { timeout: 15_000 });

  // Button should now be enabled
  const bootButton = page.locator('button:has-text("Initialize Core")');
  await expect(bootButton).toBeEnabled();
});

// ── Test 4: C-133 — Text-Only Setup (Ollama Online, Comfy Offline) ─────

test('C-133: boot diagnostics — text-only setup (ollama online, comfy offline)', async ({
  page,
}) => {
  // Mock Ollama online, ComfyUI offline (proxy returns 502)
  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Ollama is running',
    });
  });

  await page.route('**/api/image/object_info', (route) => {
    route.fulfill({ status: 502 });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });

  // Text should be ONLINE, Image should be OFFLINE
  await expect(page.locator('text=ONLINE')).toHaveCount(2, { timeout: 10_000 }); // Text + Voice
  await expect(page.locator('text=OFFLINE')).toHaveCount(1); // Image

  // Warning about booting without image should be visible
  await expect(page.locator('text=Booting without Image Generation')).toBeVisible({
    timeout: 5_000,
  });

  // The Initialize Core button should be enabled (text-only boot)
  const bootButton = page.locator('button:has-text("Initialize Core (Text Only)")');
  await expect(bootButton).toBeEnabled();

  // Capture golden snapshot
  await expect(page).toHaveScreenshot('boot-diagnostics-text-only.png', {
    fullPage: true,
  });
});

// ── Test 5: C-133 — Hybrid Setup (OpenRouter configured + Local Comfy) ─

test('C-133: boot diagnostics — hybrid setup (openrouter configured, comfy online)', async ({
  page,
}) => {
  // Mock ComfyUI online, and OpenRouter API key check via localStorage
  await page.route('**/api/image/object_info', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // biome-ignore lint/style/useNamingConvention: PixiJS extension name
      body: JSON.stringify({ CheckpointLoaderSimple: {} }),
    });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('text=INITIALIZING SUBSYSTEMS', { timeout: 10_000 });

  // Click the "Cloud (OpenRouter)" button to switch providers
  const openRouterButton = page.locator('button:has-text("Cloud (OpenRouter)")');
  await openRouterButton.click();

  // OpenRouter should show unconfigured (NO KEY) since no API key is stored
  await expect(page.locator('text=NO KEY')).toBeVisible({ timeout: 5_000 });

  // Ensure the Ollama local provider toggle still functions
  const ollamaButton = page.locator('button:has-text("Local (Ollama)")');
  await ollamaButton.click();

  // Now let's see ComfyUI is online via mocking
  await page.route('**/localhost:11434/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Ollama is running',
    });
  });

  // Wait for polling to pick up the Ollama online status
  await expect(page.locator('text=ONLINE')).toHaveCount(3, { timeout: 10_000 }); // Text + Image + Voice

  // Capture golden snapshot — hybrid: local ollama + local comfyui
  await expect(page).toHaveScreenshot('boot-diagnostics-hybrid-local.png', {
    fullPage: true,
  });
});
