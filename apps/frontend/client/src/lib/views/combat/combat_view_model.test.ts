// apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts
//
// Unit tests for CombatViewModel C-148 Combat Immersion features:
// - Dice roll state (activeDiceRoll parsing + lifecycle)
// - Scene image generation (combatBackgroundImageUrl)
// - Enemy quote integration (appended to combat log)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/combat_view_model.test.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts

import { CombatViewModel, type CombatViewModelOptions } from './combat_view_model.svelte.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Creates a fresh CombatViewModel instance with test options. */
const createViewModel = (): CombatViewModel => {
  const options: CombatViewModelOptions = {
    className: 'CombatViewModelTest',
  };
  return new CombatViewModel(options);
};

/** Extracts the active dice roll value with a non-null assertion guard. */
const getDiceRoll = (vm: CombatViewModel) => {
  const roll = vm.activeDiceRoll;
  if (!roll) {
    throw new Error('Expected activeDiceRoll to be non-null');
  }
  return roll;
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CombatViewModel — C-148 Combat Immersion', () => {
  // -----------------------------------------------------------------------
  // Dice roll state
  // -----------------------------------------------------------------------

  describe('activeDiceRoll', () => {
    let viewModel: CombatViewModel;

    beforeEach(() => {
      viewModel = createViewModel();
    });

    afterEach(() => {
      // Clear any pending dice timeout
      const vm = viewModel as unknown as {
        _diceTimeout: ReturnType<typeof setTimeout> | null;
      };
      if (vm._diceTimeout) {
        clearTimeout(vm._diceTimeout);
      }
    });

    test('should be null initially', () => {
      expect(viewModel.activeDiceRoll).toBeNull();
    });

    test('should parse dice roll from hit message', () => {
      // Access private _triggerDiceRoll for focused unit testing
      const vm = viewModel as unknown as {
        _triggerDiceRoll: (message: string) => void;
      };
      vm._triggerDiceRoll('Player rolls 17 (+4 = 21) to hit. Hits for 8 damage! (Enemy HP: 72/80)');

      const dice = getDiceRoll(viewModel);
      expect(dice.value).toBe(17);
      expect(dice.isRolling).toBe(true);
      expect(dice.isSuccess).toBe(true);
    });

    test('should parse dice roll from miss message', () => {
      const vm = viewModel as unknown as {
        _triggerDiceRoll: (message: string) => void;
      };
      vm._triggerDiceRoll('Player rolls 5 (+4 = 9) vs Evasion 12 — Miss!');

      const dice = getDiceRoll(viewModel);
      expect(dice.value).toBe(5);
      expect(dice.isRolling).toBe(true);
      expect(dice.isSuccess).toBe(false);
    });

    test('should parse enemy dice roll message', () => {
      const vm = viewModel as unknown as {
        _triggerDiceRoll: (message: string) => void;
      };
      vm._triggerDiceRoll('Enemy rolls 14 (+3 = 17) to hit. Deals 6 damage! (Player HP: 94/100)');

      const dice = getDiceRoll(viewModel);
      expect(dice.value).toBe(14);
      expect(dice.isRolling).toBe(true);
      expect(dice.isSuccess).toBe(true); // Not a miss
    });

    test('should be null for message without dice pattern', () => {
      const vm = viewModel as unknown as {
        _triggerDiceRoll: (message: string) => void;
      };
      vm._triggerDiceRoll('Player takes a defensive stance!');

      expect(viewModel.activeDiceRoll).toBeNull();
    });

    test('should be null for empty message', () => {
      const vm = viewModel as unknown as {
        _triggerDiceRoll: (message: string) => void;
      };
      vm._triggerDiceRoll('');

      expect(viewModel.activeDiceRoll).toBeNull();
    });

    test('should transition from rolling to resolved after timeout', async () => {
      const vm = viewModel as unknown as {
        _triggerDiceRoll: (message: string) => void;
      };
      vm._triggerDiceRoll('Player rolls 20 (+5 = 25) — Critical hit!');

      expect(getDiceRoll(viewModel).isRolling).toBe(true);

      // Wait for the 1.5s animation to resolve
      await new Promise((resolve) => setTimeout(resolve, 1600));

      const dice = getDiceRoll(viewModel);
      expect(dice.isRolling).toBe(false);
      expect(dice.value).toBe(20);
    });
  });

  // -----------------------------------------------------------------------
  // Scene image generation
  // -----------------------------------------------------------------------

  describe('combatBackgroundImageUrl', () => {
    let viewModel: CombatViewModel;

    beforeEach(() => {
      viewModel = createViewModel();
    });

    test('should be null initially', () => {
      expect(viewModel.combatBackgroundImageUrl).toBeNull();
    });

    test('should not generate scene when not in combat', () => {
      // Not in combat (currentTurnEntity is null)
      viewModel.generateSceneImage();

      // Should remain null — generates scene is blocked when !inCombat
      expect(viewModel.combatBackgroundImageUrl).toBeNull();
    });
  });
});
