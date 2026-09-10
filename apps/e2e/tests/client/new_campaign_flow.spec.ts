// apps/e2e/tests/client/new_campaign_flow.spec.ts
//
// E2E tests for the new-campaign entry flow.
//
// AC-1: fresh install → "New Game" routes to /setup (the AI-provider
//       welcome screen), then "Start Campaign" reaches persona creation
//       (onboarding) — WITHOUT passing through the world-generation wizard,
//       and WITHOUT any world-generation AI call (request spy, not timing).
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

  test('AC-1: fresh start routes through /setup to persona creation', async ({ page }) => {
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

    // New Game — the front door. Routes to /setup, not the pack picker.
    await page.getByRole('button', { name: 'New Game' }).click();

    // Lands on the AI-provider welcome screen.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/setup(?:[?#].*)?$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Welcome to Aikami' })).toBeVisible();

    // Start Campaign proceeds to persona creation (onboarding), never the wizard.
    await page.getByRole('button', { name: 'Start Campaign' }).click();
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
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/setup(?:[?#].*)?$/, { timeout: 10000 });

    // Start Campaign proceeds to onboarding.
    await page.getByRole('button', { name: 'Start Campaign' }).click();

    // Onboarding coordinator presents starter heroes as the primary affordance.
    await expect(page.getByRole('heading', { name: 'Choose Your Hero' })).toBeVisible({
      timeout: 10000,
    });

    // Pick the first starter hero card → lands on the lightweight fast path
    // (name + one motivating choice), NOT the full editable review sheet.
    await page.locator('button').filter({ hasText: 'Thaldrin' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ready to Go?' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /Enter World/ })).toBeVisible();
    // The full sheet must not be a required step on the fast path.
    await expect(page.getByRole('button', { name: 'Customize Everything' })).toBeVisible();

    // Fast path: confirm with the pre-filled name and enter the world.
    // AC-4: measure the preset path from selection to world entry.
    const presetStart = Date.now();
    await page.getByRole('button', { name: /Enter World/ }).click();

    // Campaign completes setup and boots the game.
    await expect(page).toHaveURL(/\/game/, { timeout: 15000 });
    const presetPathMs = Date.now() - presetStart;
    // AC-4 evidence: the preset fast path must complete in a bounded time —
    // a full-sheet review step (rendering + manual edit) would not fit in
    // this window. The verifier can compare against a timed AI-path run.
    expect(presetPathMs).toBeLessThan(10000);
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
