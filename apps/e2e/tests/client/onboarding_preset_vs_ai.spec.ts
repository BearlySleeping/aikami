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

import { expect, type Page, test } from '@playwright/test';
import { OnboardingPage } from '$pom';

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
const mockTextProvider = async (page: Page): Promise<void> => {
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

const preparePage = async (page: Page): Promise<void> => {
  await page.addInitScript(AI_GATE_BYPASS);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // best effort
    }
  });
};

test.describe('Onboarding preset vs AI path timing — C-498 AC-4', () => {
  test('AI chat-to-persona path is not faster than the preset path', async ({
    baseURL,
    browser,
  }) => {
    const presetPage = await browser.newPage({ baseURL });
    await preparePage(presetPage);
    const presetOnboarding = new OnboardingPage(presetPage);
    await presetPage.goto('/');
    await presetPage.getByRole('button', { name: 'New Adventure' }).click();
    await presetOnboarding.expectChooseYourHeroVisible(20_000);
    await presetOnboarding.selectStarterHero('Thaldrin');
    await presetOnboarding.expectReadyToGoVisible();
    await presetOnboarding.selectMotivation('Let the preset decide');
    const presetStart = Date.now();
    await presetOnboarding.enterWorld();
    await expect(presetPage).toHaveURL(/\/game/, { timeout: 20_000 });
    const presetMs = Date.now() - presetStart;
    console.log(`[C-498 AC-4] preset path → /game: ${presetMs}ms`);
    expect(presetMs).toBeLessThan(10_000);
    await presetPage.close();

    const aiPage = await browser.newPage({ baseURL });
    await preparePage(aiPage);
    await mockTextProvider(aiPage);
    const aiOnboarding = new OnboardingPage(aiPage);
    await aiPage.goto('/');
    await aiPage.getByRole('button', { name: 'New Adventure' }).click();
    await aiOnboarding.expectChooseYourHeroVisible(20_000);
    await aiOnboarding.startChat();
    await aiOnboarding.expectChatPromptVisible();
    await aiOnboarding.sendChatPrompt('I want to play a brave human fighter.');
    await aiOnboarding.expectGenerateCharacterVisible();

    const aiStart = Date.now();
    await aiOnboarding.generateCharacter();
    await expect(aiPage).toHaveURL(/\/game/, { timeout: 30_000 });
    const aiMs = Date.now() - aiStart;
    console.log(`[C-498 AC-4] AI chat-to-persona path → /game: ${aiMs}ms`);
    expect(aiMs).toBeGreaterThanOrEqual(presetMs);
    await aiPage.close();
  });
});
