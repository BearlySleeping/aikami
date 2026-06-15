/** biome-ignore-all lint/style/useNamingConvention: Ollama API uses snake_case fields */
// apps/e2e/tests/client/dialogue_visual.spec.ts
// Dialogue Visual Test — verifies the dialogue overlay renders with DaisyUI
// chat bubbles, handles Ollama streaming mock, and captures a visual
// snapshot for regression testing.
//
// Contract: C-129 Dialogue AI Integration & Polish
//
// Uses the client-visual Playwright project (no auth dependency, WebGL enabled).

import { expect, test } from '@playwright/test';

const GAME_URL = 'http://localhost:5274/game';

// ── Test 1: Blackbox Flow — Mock Ollama streaming ──────────────────────

test('dialogue overlay renders chat bubbles and streams AI response', async ({ page }) => {
  // ── Mock Ollama's /api/generate endpoint ───────────────────────
  // Ollama streams application/x-ndjson — each line is a JSON object
  // with a "response" field and "done" boolean.
  await page.route('**/localhost:11434/api/generate', (route) => {
    const chunks = [
      JSON.stringify({
        model: 'llama3',
        created_at: new Date().toISOString(),
        response: 'Hello',
        done: false,
      }),
      JSON.stringify({
        model: 'llama3',
        created_at: new Date().toISOString(),
        response: ', ',
        done: false,
      }),
      JSON.stringify({
        model: 'llama3',
        created_at: new Date().toISOString(),
        response: 'traveller',
        done: false,
      }),
      JSON.stringify({
        model: 'llama3',
        created_at: new Date().toISOString(),
        response: '!',
        done: true,
      }),
    ];

    const body = `${chunks.join('\n')}\n`;

    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    });
  });

  // ── Navigate to the game page ──────────────────────────────────
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the game UI layer to mount (canvas + overlay container)
  await page.waitForSelector('#game-ui-layer', { timeout: 20_000 });

  // ── Trigger dialogue overlay ───────────────────────────────────
  // The dialogue overlay is triggered via ECS NPC interaction events.
  // For this visual test, we programmatically dispatch the event to
  // simulate an NPC interaction without needing the full game engine.
  await page.evaluate(() => {
    const event = new CustomEvent('npc-dialogue-start', {
      detail: {
        npcId: 'test-npc-001',
        npcName: 'Elder Thrain',
        dialog: 'Welcome, traveller! What brings you to our village?',
      },
    });
    window.dispatchEvent(event);
  });

  // Wait for the dialogue overlay to appear
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });

  // Verify the NPC greeting is visible in a chat bubble
  const greeting = page.locator('.chat-bubble').first();
  await expect(greeting).toBeVisible({ timeout: 5_000 });

  // Verify the NPC name appears in the header
  await expect(page.locator('h3')).toContainText('Elder Thrain');

  // ── Type a player message and send ──────────────────────────────
  const textarea = page.locator('textarea');
  await expect(textarea).toBeVisible();

  await textarea.fill('Hello, Elder!');
  await textarea.press('Enter');

  // Wait for the streaming indicator (loading-dots) to appear
  await page.waitForSelector('.loading-dots', { timeout: 5_000 });

  // Wait for streaming to complete (loading-dots disappear)
  await page.waitForSelector('.loading-dots', { state: 'detached', timeout: 10_000 });

  // Verify the NPC response appears in a chat bubble
  const responseText = page.locator('.chat-bubble').last();
  await expect(responseText).toBeVisible();

  // Verify player message is styled as chat-end (right-aligned)
  const playerBubble = page.locator('.chat-end .chat-bubble').first();
  await expect(playerBubble).toBeVisible();

  // Verify NPC message is styled as chat-start (left-aligned)
  const npcBubble = page.locator('.chat-start .chat-bubble').first();
  await expect(npcBubble).toBeVisible();
});

// ── Test 2: Visual Regression — Screenshot with populated bubbles ──────

test('dialogue overlay visual regression snapshot', async ({ page }) => {
  // ── Mock Ollama with a single-chunk response ───────────────────
  await page.route('**/localhost:11434/api/generate', (route) => {
    const body = `${JSON.stringify({
      model: 'llama3',
      created_at: new Date().toISOString(),
      response: 'Ah, a brave soul! The kingdom has awaited one such as you.',
      done: true,
    })}\n`;

    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    });
  });

  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#game-ui-layer', { timeout: 20_000 });

  // Trigger dialogue overlay with NPC data
  await page.evaluate(() => {
    const event = new CustomEvent('npc-dialogue-start', {
      detail: {
        npcId: 'test-npc-002',
        npcName: 'Captain Aldric',
        dialog: 'Halt! State your business in these lands.',
      },
    });
    window.dispatchEvent(event);
  });

  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });

  // Type player message and send
  const textarea = page.locator('textarea');
  await textarea.fill("I'm just passing through, Captain.");
  await textarea.press('Enter');

  // Wait for streaming to complete
  await page.waitForSelector('.loading-dots', { timeout: 5_000 });
  await page.waitForSelector('.loading-dots', { state: 'detached', timeout: 10_000 });

  // Both bubbles should now be visible
  await expect(page.locator('.chat-bubble')).toHaveCount(2, { timeout: 5_000 });

  // Capture screenshot for visual regression comparison
  await page.screenshot({
    path: 'test-results/dialogue-visual/dialogue-overlay.png',
    fullPage: true,
  });

  // Verify z-index layering: dialogue overlay should have z-10 or higher
  const overlayZIndex = await page.$eval('[role="dialog"]', (el) => {
    return window.getComputedStyle(el).zIndex;
  });
  expect(overlayZIndex).not.toBe('auto');
  expect(Number.parseInt(overlayZIndex, 10)).toBeGreaterThanOrEqual(10);

  // Verify pointer-events-auto on the overlay (so clicks work)
  const pointerEvents = await page.$eval('[role="dialog"]', (el) => {
    return window.getComputedStyle(el).pointerEvents;
  });
  expect(pointerEvents).toBe('auto');
});
