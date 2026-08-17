// apps/e2e/tests/client/new_campaign_flow.spec.ts
//
// E2E tests for the C-405 new-campaign entry flow.
//
// AC-1: fresh install → "Start campaign" → pack picker (2+ packs) → persona
//       creation (onboarding) — WITHOUT passing through the world-generation
//       wizard, and WITHOUT any world-generation AI call (request spy, not
//       timing).
// AC-3: the picker lists both installed packs with name + description and the
//       chosen pack id reaches startNewCampaign.
// AC-4: the Advanced entry (/worldgen) renders the wizard with an honest
//       preview notice.
//
// Contract: C-405 Cut World Generation from the Critical Path

import { expect, test } from '@playwright/test';

// Bypass the mandatory text-provider gate so the default path can proceed to
// persona creation without configuring an AI provider in the test context.
const AI_GATE_BYPASS = `
  window.__AIKAMI_AI_GATE_BYPASS__ = true;
`;

test.describe('New Campaign Flow — C-405', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(AI_GATE_BYPASS);
    // Fresh install: no saved characters, no saves.
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // best effort — storage may not exist on about:blank
      }
    });
  });

  test('AC-1: fresh start reaches persona creation without world generation', async ({ page }) => {
    // ── Request spy: any world-gen / AI-provider call during the default
    //    path is a regression (asserted via the spy, never by timing). ──
    const aiRequestUrls: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      // Real AI-provider API endpoints (text/voice/image microservices on
      // their fixed emulator ports + external LLM hosts). Dev-server source
      // module fetches (localhost:10554) must NOT match.
      if (
        /localhost:(11434|8089|8087|8188)\/|api\.openrouter\.ai|generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.deepseek\.com|api\.groq\.com|api\.openai\.com/i.test(
          url,
        )
      ) {
        aiRequestUrls.push(url);
      }
      route.continue();
    });

    await page.goto('/');

    // Start campaign — the front door.
    await page.getByRole('button', { name: 'New Game' }).click();

    // AC-3: with both emberwatch and whispering-caves installed, the pack
    // picker must appear listing both packs by name.
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await expect(page.getByText('Choose Your Adventure')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Select Emberwatch: The Fading Ward' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select Whispering Caves' })).toBeVisible();

    // Pick the second pack and confirm.
    await page.getByRole('button', { name: 'Select Whispering Caves' }).click();
    await page.getByRole('button', { name: 'Start New Game' }).click();

    // AC-1: lands on persona creation (onboarding), never the wizard.
    await expect(page.getByRole('heading', { name: 'Choose Your Hero' })).toBeVisible({
      timeout: 10000,
    });
    expect(page.url()).toContain('/personas/create');

    // The world-gen wizard must not be present.
    await expect(page.getByRole('heading', { name: 'Genre' })).toHaveCount(0);

    // No world-generation AI provider call was made on the default path.
    expect(aiRequestUrls).toEqual([]);
  });

  test('AC-1: selecting a starter hero completes the flow into /game', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'New Game' }).click();
    await expect(page.getByText('Choose Your Adventure')).toBeVisible();

    // Default selection is the first pack — confirm directly.
    await page.getByRole('button', { name: 'Start New Game' }).click();

    // Onboarding coordinator with three starter heroes.
    await expect(page.getByRole('heading', { name: 'Choose Your Hero' })).toBeVisible({
      timeout: 10000,
    });

    // Pick the first starter hero card.
    await page.locator('button').filter({ hasText: 'Thaldrin' }).first().click();

    // Campaign completes setup and boots the game.
    await expect(page).toHaveURL(/\/game/, { timeout: 15000 });
  });

  test('AC-4: /worldgen Advanced entry is reachable and honestly labelled', async ({ page }) => {
    await page.goto('/');

    // Advanced entry on the start screen.
    await page.locator('summary', { hasText: 'Advanced' }).click();
    await page.getByRole('button', { name: 'World Generation (Preview)' }).click();

    // The wizard renders on its own production route (not /dev).
    await expect(page).toHaveURL(/\/worldgen/);
    await expect(page.locator('progress.progress')).toBeAttached({ timeout: 10000 });

    // The preview notice states plainly that the world is not playable yet.
    const notice = page.getByTestId('worldgen-preview-badge');
    await expect(notice).toBeVisible();
    await expect(page.getByText(/preview and is not playable yet/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'issue #81' })).toBeVisible();
  });
});
