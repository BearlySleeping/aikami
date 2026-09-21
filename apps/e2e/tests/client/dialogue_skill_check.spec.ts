// apps/e2e/tests/client/dialogue_skill_check.spec.ts
//
// C-487 AC-6: the production /game dialogue journey honours the real character
// sheet. Drives the PRODUCTION route (`/game`), overlay and ViewModel — never
// the dev sandbox. The spec seeds two window globals before the client bundle
// loads (the sanctioned "stubbed provider in the E2E harness" mechanism):
//
//   __AIKAMI_E2E_SHEET__          — an authored sheet: CHA 16 (+3), Persuasion
//                                   proficiency, no expertise → declared total +5
//   __AIKAMI_E2E_DIALOGUE_INTENT__ — a deterministic intent envelope, because a
//                                   live model cannot produce requiresRoll=true
//                                   deterministically
//
// Run: bun moon run e2e:test-client -- --grep dialogue_skill_check

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom/game_page';

const seedSkillCheck = (page: import('playwright').Page, options?: { requiresRoll?: boolean }) => {
  const requiresRoll = options?.requiresRoll ?? true;
  return page.addInitScript(
    ({ roll }: { roll: boolean }) => {
      const win = window as unknown as Record<string, unknown>;
      win.__AIKAMI_E2E_SHEET__ = {
        abilities: {
          strength: { value: 10, modifier: 0 },
          dexterity: { value: 10, modifier: 0 },
          constitution: { value: 10, modifier: 0 },
          intelligence: { value: 10, modifier: 0 },
          wisdom: { value: 10, modifier: 0 },
          charisma: { value: 16, modifier: 3 },
        },
        skills: [
          {
            name: 'Persuasion',
            ability: 'charisma',
            isProficient: true,
            isExpertise: false,
            modifier: 0,
          },
        ],
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
      win.__AIKAMI_E2E_DIALOGUE_INTENT__ = roll
        ? {
            requiresRoll: true,
            checkType: 'Persuasion',
            difficultyClass: 12,
            modifierSource: 'CHA',
            npcResponse: 'The guard studies you carefully.',
            suggestedChips: [],
          }
        : {
            requiresRoll: false,
            checkType: undefined,
            difficultyClass: undefined,
            modifierSource: undefined,
            npcResponse: 'A fine day to you, traveler.',
            suggestedChips: [],
          };
    },
    { roll: requiresRoll },
  );
};

test.describe('Dialogue skill check honours the character sheet (C-487)', () => {
  test('AC-6: /game declares the computed modifier and stakes before the roll', async ({
    page,
  }) => {
    await seedSkillCheck(page, { requiresRoll: true });

    const game = new GamePage(page);
    await game.goto();
    await game.approachAndTalkToNpc();
    await game.expectDialogueVisible();
    await game.expectFreeTextInput();

    await game.sendFreeText('I try to persuade the guard.');

    // The production overlay must show the declared-DC breakdown + stakes.
    await game.expectDiceOverlayVisible();
    await expect(game.diceBreakdown).toContainText('CHA');
    await expect(game.diceBreakdown).toContainText('+3');
    await expect(game.diceBreakdown).toContainText('+5');
    await expect(game.diceBreakdown).toContainText('DC 12');
    await expect(game.diceStakesFailure).toContainText(/trust|suspicion/i);

    // Roll is proposed but not yet committed — the dice is present and
    // interactive only after the declaration is acknowledged (C-330).
    await expect(game.d20RollButton).toBeVisible();
  });

  test('AC-4: a neutral greeting never shows the dice', async ({ page }) => {
    await seedSkillCheck(page, { requiresRoll: false });

    const game = new GamePage(page);
    await game.goto();
    await game.approachAndTalkToNpc();
    await game.expectDialogueVisible();
    await game.expectFreeTextInput();

    await game.sendFreeText('Hello there.');

    await expect(game.npcResponse).toContainText('A fine day to you, traveler.');
    await game.expectNoDiceOverlay();
  });
});
