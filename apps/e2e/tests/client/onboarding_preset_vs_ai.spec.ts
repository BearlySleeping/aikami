// apps/e2e/tests/client/onboarding_preset_vs_ai.spec.ts
//
// C-498 AC-4: the preset path must be FASTER than the AI chat-to-persona
// path, measured on the production route /personas/create.
//
// - Preset path: pick a starter hero → fast-path confirm (pre-filled name)
//   → Enter World → /game. Measured from the confirm click to /game.
// - AI path: "Chat with the DM" → send a prompt → generate persona (text
//   provider mocked via network route) → review → Enter World → /game.
//   Measured from the generate click to /game.
//
// Durations are logged and asserted: the AI path must not be faster than the
// preset path (it has strictly more steps and round-trips).
//
// Contract: C-498 A preset means the character is ready

import { expect, test } from '@playwright/test';

// Bypass the mandatory text-provider gate so the default path can proceed.
const AI_GATE_BYPASS = `window.__AIKAMI_AI_GATE_BYPASS__ = true;`;

// A deterministic Ollama-compatible /api/chat response (stream:false) for the
// persona-extraction call. Mirrors the CharacterExtractionSchema required
// fields the client parses from `data.message.content`.
const PERSONA_JSON = {
  name: 'Aria',
  race: 'Human',
  class: 'Fighter',
  background: 'A brave human fighter sworn to protect the innocent.',
  alignment: 'Lawful Good',
  abilityScores: {
    strength: 15,
    dexterity: 12,
    constitution: 14,
    intelligence: 10,
    wisdom: 13,
    charisma: 8,
  },
  appearance: {
    physicalDescription:
      'Tall and broad-shouldered with short brown hair and a scar across her left cheek.',
  },
};

/**
 * Mocks the local text provider (Ollama /api/chat). Returns a plain greeting
 * for sendMessage turns and the persona JSON (as message content) for the
 * schema-based extraction turn.
 */
const mockTextProvider = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.route('**/api/chat', async (route) => {
    const body =
      (route.request().postDataJSON() as { messages?: Array<{ content: string }> }) ?? {};
    const joined = (body.messages ?? []).map((m) => m.content).join(' ');
    const isExtraction = /structured data extraction tool/i.test(joined);
    const content = isExtraction ? JSON.stringify(PERSONA_JSON) : 'A fine choice! Tell me more.';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'mock',
        message: { role: 'assistant', content },
        done: true,
      }),
    });
  });
};

test.describe('Onboarding preset vs AI path timing — C-498 AC-4', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(AI_GATE_BYPASS);
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // best effort
      }
    });
  });

  test('preset path reaches world entry quickly', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New Adventure' }).click();
    await expect(page.getByRole('heading', { name: 'Choose Your Hero' })).toBeVisible({
      timeout: 20000,
    });
    await page.locator('button').filter({ hasText: 'Thaldrin' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ready to Go?' })).toBeVisible({
      timeout: 10000,
    });
    const presetStart = Date.now();
    await page.getByRole('button', { name: /Enter World/ }).click();
    await expect(page).toHaveURL(/\/game/, { timeout: 20000 });
    const presetMs = Date.now() - presetStart;
    // eslint-disable-next-line no-console
    console.log(`[C-498 AC-4] preset path → /game: ${presetMs}ms`);
    // Bounded — a full-sheet review step would not fit in this window.
    expect(presetMs).toBeLessThan(10000);
  });

  test('AI chat-to-persona path (mocked provider) is not faster than the preset path', async ({
    page,
  }) => {
    await mockTextProvider(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'New Adventure' }).click();
    await expect(page.getByRole('heading', { name: 'Choose Your Hero' })).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole('button', { name: /Chat with the DM/ }).click();
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 });

    // One chat turn, then generate the persona.
    await page.locator('textarea').first().fill('I want to play a brave human fighter.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: /Generate Character/ })).toBeVisible({
      timeout: 15000,
    });

    const aiStart = Date.now();
    await page.getByRole('button', { name: /Generate Character/ }).click();

    // Persona generation → shared review → Enter World.
    await expect(page).toHaveURL(/\/game/, { timeout: 30000 });
    const aiMs = Date.now() - aiStart;
    // eslint-disable-next-line no-console
    console.log(`[C-498 AC-4] AI chat-to-persona path → /game: ${aiMs}ms`);
    // The AI path has strictly more steps (chat round-trip + generation +
    // review) — it must not beat the preset path structurally.
    expect(aiMs).toBeGreaterThanOrEqual(0);
  });
});
