// apps/e2e/tests/client/dialogue_branching_gating.spec.ts
//
// C-490: Transcript branching must not imply rewinding the world.
//
// AC-1: in campaign play (`/game`), the dialogue overlay must NOT offer
// transcript-rewinding actions (branch/edit/delete) — only Copy stays, and
// retry reads "Rephrase" (AC-2). Those controls REMAIN available in the dev
// sandbox (which mounts the production overlay with a non-campaign VM).
//
// Drives the PRODUCTION `/game` route via the same sanctioned
// `__AIKAMI_E2E_DIALOGUE_INTENT__` seed mechanism as dialogue_skill_check.spec.ts.
//
// Run: bun moon run e2e:test-client -- --grep dialogue_branching_gating

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom/game_page';

/** Seeds a deterministic (non-roll) intent + a minimal sheet before boot. */
const seedNeutralIntent = (page: import('playwright').Page) =>
  page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    win.__AIKAMI_E2E_SHEET__ = {
      abilities: {
        strength: { value: 10, modifier: 0 },
        dexterity: { value: 10, modifier: 0 },
        constitution: { value: 10, modifier: 0 },
        intelligence: { value: 10, modifier: 0 },
        wisdom: { value: 10, modifier: 0 },
        charisma: { value: 10, modifier: 0 },
      },
      skills: [],
      savingThrows: [],
      traits: { personalityTraits: '', ideals: '', bonds: '', flaws: '' },
      narrativeTraits: { likes: [], temptations: [], keys: [] },
      proficiencyBonus: 2,
      level: 1,
      xp: 0,
      hp: 10,
      maxHp: 10,
      attack: 0,
      defense: 10,
    };
    win.__AIKAMI_E2E_DIALOGUE_INTENT__ = {
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'A fine day to you, traveler.',
      suggestedChips: [],
    };
  });

test.describe('C-490 dialogue transcript gating', () => {
  test('AC-1/AC-2: campaign /game dialogue offers no branch/edit/delete; retry reads Rephrase', async ({
    page,
  }) => {
    await seedNeutralIntent(page);

    const game = new GamePage(page);
    await game.goto();
    // A fresh profile boots to the movement tutorial — dismiss it so the NPC
    // interaction below is reachable.
    const skipTutorial = page.getByRole('button', { name: 'Skip tutorial' });
    if ((await skipTutorial.count()) > 0) {
      await skipTutorial.first().click();
      await page.waitForTimeout(500);
    }
    await game.approachAndTalkToNpc();
    await game.expectDialogueVisible();
    await game.expectFreeTextInput();

    // Produce an NPC message so its action affordances render.
    await game.sendFreeText('Hello there.');
    await expect(game.npcResponse).toContainText('A fine day to you, traveler.', {
      timeout: 15_000,
    });

    const overlay = page.locator('[data-testid="dialogue-overlay"]');

    // Hover an NPC bubble to reveal the hover-visible action buttons.
    const npcBubble = overlay.locator('.rounded-bl-md.bg-base-100').first();
    await npcBubble.hover();

    // Transcript-rewinding controls are NOT offered in campaign play.
    await expect(overlay.getByRole('button', { name: 'Branch' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    // Copy stays and retry is honestly relabelled "Rephrase" (AC-2).
    await expect(overlay.getByRole('button', { name: 'Copy' })).not.toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Rephrase' })).not.toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Retry' })).toHaveCount(0);

    // No branch selector is offered either.
    await expect(overlay.getByText(/^Branch:/)).toHaveCount(0);
  });

  test('AC-1: the dev sandbox still offers branch/edit/delete (non-campaign)', async ({ page }) => {
    await page.goto('/dev/sandbox/dialogue', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { state: 'visible', timeout: 15_000 });
    await page.getByText('Ah, a traveler!').waitFor({ state: 'visible', timeout: 10_000 });

    // Send a free-text message to render an NPC message with action affordances.
    await page.locator('textarea').first().fill('Tell me about the ward');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    const overlay = page.locator('[data-testid="dialogue-overlay"]');
    const npcBubble = overlay.locator('.rounded-bl-md.bg-base-100').first();
    await npcBubble.hover();

    // In the sandbox the transcript-rewinding controls remain available.
    await expect(overlay.getByRole('button', { name: 'Branch' })).not.toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Edit' })).not.toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Delete' })).not.toHaveCount(0);
  });
});
