// apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts
//
// Unit tests for CombatViewModel:
// - C-148 Combat Immersion (dice roll state, enemy quotes, scene images)
// - C-149 Combat Gatekeeping (actionValid gatekeeping)
// - C-151 AI Dynamic Music (sceneMood → BGM crossfade)
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

  // -----------------------------------------------------------------------
  // Gatekeeping — C-149 Combat Mechanics & AI Gatekeeping
  // -----------------------------------------------------------------------

  describe('executeCustomAction — C-149 Gatekeeping', () => {
    let viewModel: CombatViewModel;
    let bridgeSendCalls: Array<Record<string, unknown>>;

    beforeEach(() => {
      viewModel = createViewModel();
      bridgeSendCalls = [];

      // Set up mock engine bridge
      const vm = viewModel as unknown as {
        _bridge: { send: (cmd: Record<string, unknown>) => void; on: () => () => void };
      };
      vm._bridge = {
        send: (cmd: Record<string, unknown>) => {
          bridgeSendCalls.push(cmd);
        },
        on: () => () => {}, // No-op listener cleanup
      };

      // Put the ViewModel in an active combat state
      viewModel.currentTurnEntity = 1;
      viewModel.enemyEntityId = 2;
      viewModel.enemyName = 'Goblin';
      viewModel.playerHp = 80;
      viewModel.playerMaxHp = 100;
      viewModel.enemyHp = 60;
      viewModel.enemyMaxHp = 80;
      viewModel.activeEntities = [1, 2];
      viewModel.playerLevel = 3;
      viewModel.playerAttack = 7;
      viewModel.playerDefense = 14;
    });

    test('should append invalidReason to combat log when actionValid is false', async () => {
      // Mock textGenerationService to return a gatekept response
      const extractStructureMod = await import(
        '$lib/services/ai/text_generation_service.svelte.ts'
      );
      const origExtract = (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure;

      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = async () => ({
        actionType: 'ATTACK',
        narrative: "You reach for your potion belt — but it's empty!",
        bonusDamage: 0,
        advantage: false,
        generateImage: false,
        actionValid: false,
        invalidReason:
          'You reach for a healing potion, but your bags are empty! The goblin snickers at your misfortune.',
      });

      await viewModel.executeCustomAction('I drink a healing potion');

      // The invalid reason should appear in the combat log
      const logString = viewModel.combatLog.map((e) => e.actionText).join(' ');
      expect(logString).toContain('bags are empty');
      expect(logString).toContain('potion belt');

      // The engine command must NOT be dispatched
      expect(bridgeSendCalls.length).toBe(0);

      // Should not be stuck in resolving state
      expect(viewModel.isResolvingAiAction).toBe(false);

      // Restore original
      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = origExtract;
    });

    test('should dispatch COMBAT_ACTION when actionValid is true', async () => {
      const extractStructureMod = await import(
        '$lib/services/ai/text_generation_service.svelte.ts'
      );
      const origExtract = (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure;

      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = async () => ({
        actionType: 'ATTACK',
        narrative: 'You swing your sword in a wide arc!',
        bonusDamage: 2,
        advantage: false,
        generateImage: false,
        actionValid: true,
      });

      await viewModel.executeCustomAction('I swing my sword at the goblin');

      // The engine command MUST be dispatched
      expect(bridgeSendCalls.length).toBe(1);
      expect(bridgeSendCalls[0].type).toBe('COMBAT_ACTION');
      expect(bridgeSendCalls[0].action).toBe('ATTACK');

      // Should not be stuck in resolving state
      expect(viewModel.isResolvingAiAction).toBe(false);

      // Restore original
      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = origExtract;
    });
  });

  // -----------------------------------------------------------------------
  // C-151: AI Dynamic Music — sceneMood triggers BGM crossfade
  // -----------------------------------------------------------------------

  describe('executeCustomAction — C-151 AI Dynamic Music', () => {
    let viewModel: CombatViewModel;
    let bridgeSendCalls: Array<Record<string, unknown>>;

    beforeEach(() => {
      viewModel = createViewModel();
      bridgeSendCalls = [];

      // Set up mock engine bridge
      const vm = viewModel as unknown as {
        _bridge: { send: (cmd: Record<string, unknown>) => void; on: () => () => void };
      };
      vm._bridge = {
        send: (cmd: Record<string, unknown>) => {
          bridgeSendCalls.push(cmd);
        },
        on: () => () => {},
      };

      // Put the ViewModel in active combat state
      viewModel.currentTurnEntity = 1;
      viewModel.enemyEntityId = 2;
      viewModel.enemyName = 'Goblin';
      viewModel.playerHp = 80;
      viewModel.playerMaxHp = 100;
      viewModel.enemyHp = 60;
      viewModel.enemyMaxHp = 80;
      viewModel.activeEntities = [1, 2];
      viewModel.playerLevel = 3;
      viewModel.playerAttack = 7;
      viewModel.playerDefense = 14;
    });

    afterEach(() => {
      // Unmock audioService
      try {
        (
          viewModel as unknown as {
            _transitionBgmByMood: (mood: string) => Promise<void>;
          }
        )._transitionBgmByMood = async () => {};
      } catch {
        // No-op
      }
    });

    test('should call _transitionBgmByMood when LLM returns sceneMood', async () => {
      // Mock textGenerationService to return a response with sceneMood
      const extractStructureMod = await import(
        '$lib/services/ai/text_generation_service.svelte.ts'
      );
      const origExtract = (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure;

      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = async () => ({
        actionType: 'ATTACK',
        narrative: 'With a thunderous roar, you strike the killing blow!',
        bonusDamage: 3,
        advantage: true,
        generateImage: false,
        actionValid: true,
        sceneMood: 'triumph',
      });

      // Spy on _transitionBgmByMood via method override
      let wasCalled = false;
      let receivedMood = '';
      const vm = viewModel as unknown as {
        _transitionBgmByMood: (mood: string) => Promise<void>;
      };
      const origTransition = vm._transitionBgmByMood;
      vm._transitionBgmByMood = async (mood: string) => {
        wasCalled = true;
        receivedMood = mood;
      };

      await viewModel.executeCustomAction('I strike the final blow!');

      expect(wasCalled).toBe(true);
      expect(receivedMood).toBe('triumph');

      // The engine command should still be dispatched
      expect(bridgeSendCalls.length).toBe(1);

      // Restore
      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = origExtract;
      vm._transitionBgmByMood = origTransition;
    });

    test('should NOT call _transitionBgmByMood when sceneMood is undefined', async () => {
      const extractStructureMod = await import(
        '$lib/services/ai/text_generation_service.svelte.ts'
      );
      const origExtract = (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure;

      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = async () => ({
        actionType: 'ATTACK',
        narrative: 'You swing your sword at the goblin.',
        bonusDamage: 0,
        advantage: false,
        generateImage: false,
        actionValid: true,
        // sceneMood intentionally omitted
      });

      let wasCalled = false;
      const vm = viewModel as unknown as {
        _transitionBgmByMood: (mood: string) => Promise<void>;
      };
      const origTransition = vm._transitionBgmByMood;
      vm._transitionBgmByMood = async () => {
        wasCalled = true;
      };

      await viewModel.executeCustomAction('I swing my sword');

      expect(wasCalled).toBe(false);

      // Engine command should still be dispatched
      expect(bridgeSendCalls.length).toBe(1);

      // Restore
      (
        extractStructureMod.textGenerationService as {
          extractStructure: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      ).extractStructure = origExtract;
      vm._transitionBgmByMood = origTransition;
    });
  });

  // -----------------------------------------------------------------------
  // C-165: Combat Inline Images & Gallery
  // -----------------------------------------------------------------------

  describe('CombatViewModel — C-165 CombatLogEntry', () => {
    let viewModel: CombatViewModel;

    beforeEach(() => {
      viewModel = createViewModel();
    });

    // ── _parseActorFromMessage ──

    test('_parseActorFromMessage should return Player for player messages', () => {
      const vm = viewModel as unknown as {
        _parseActorFromMessage: (message: string) => string;
      };
      expect(vm._parseActorFromMessage('Player rolls 17 to hit')).toBe('Player');
    });

    test('_parseActorFromMessage should return enemy name for enemy messages', () => {
      viewModel.enemyName = 'Goblin';
      const vm = viewModel as unknown as {
        _parseActorFromMessage: (message: string) => string;
      };
      expect(vm._parseActorFromMessage('Enemy attacks — 8 damage!')).toBe('Goblin');
    });

    test('_parseActorFromMessage should fallback to System for unrecognized', () => {
      const vm = viewModel as unknown as {
        _parseActorFromMessage: (message: string) => string;
      };
      expect(vm._parseActorFromMessage('The ground shakes violently!')).toBe('System');
    });

    // ── CombatLogEntry structure from COMBAT_LOG ──

    test('combatLog should contain CombatLogEntry objects after initialization', () => {
      expect(Array.isArray(viewModel.combatLog)).toBe(true);
      expect(viewModel.combatLog.length).toBe(0);
    });

    test('_updateLogEntryImage should set imageUrl and clear isGeneratingImage', () => {
      const vm = viewModel as unknown as {
        _logEntryCounter: number;
        _turnCounter: number;
        _updateLogEntryImage: (entryId: string, url: string | undefined) => void;
        combatLog: Array<{ id: string; imageUrl?: string; isGeneratingImage?: boolean }>;
      };

      vm._logEntryCounter = 0;
      vm._turnCounter = 0;

      vm.combatLog = [
        {
          id: 'entry-1',
          turnNumber: 1,
          actor: 'Player',
          actionText: 'You strike!',
          outcomeText: '',
          isGeneratingImage: true,
        },
      ];

      vm._updateLogEntryImage('entry-1', 'https://example.com/img.png');

      expect(vm.combatLog[0].imageUrl).toBe('https://example.com/img.png');
      expect(vm.combatLog[0].isGeneratingImage).toBe(false);
    });

    test('_updateLogEntryImage should be no-op for unknown entry ID', () => {
      const vm = viewModel as unknown as {
        _updateLogEntryImage: (entryId: string, url: string | undefined) => void;
        combatLog: Array<{ id: string }>;
      };

      vm.combatLog = [
        { id: 'entry-1', turnNumber: 1, actor: 'Player', actionText: 'Test', outcomeText: '' },
      ];

      vm._updateLogEntryImage('nonexistent', 'https://example.com/img.png');
      expect(vm.combatLog[0].id).toBe('entry-1');
    });

    test('_updateLogEntryImage with undefined should clear isGeneratingImage only', () => {
      const vm = viewModel as unknown as {
        _updateLogEntryImage: (entryId: string, url: string | undefined) => void;
        combatLog: Array<{ id: string; imageUrl?: string; isGeneratingImage?: boolean }>;
      };

      vm.combatLog = [
        {
          id: 'entry-1',
          turnNumber: 1,
          actor: 'Player',
          actionText: 'You strike!',
          outcomeText: '',
          isGeneratingImage: true,
        },
      ];

      vm._updateLogEntryImage('entry-1', undefined);

      expect(vm.combatLog[0].isGeneratingImage).toBe(false);
      expect(vm.combatLog[0].imageUrl).toBeUndefined();
    });

    // ── encounterImages ──

    test('encounterImages should be empty initially', () => {
      expect(viewModel.encounterImages.length).toBe(0);
    });

    test('COMBAT_STARTED should reset encounterImages', () => {
      viewModel.encounterImages = ['img1.png', 'img2.png'];
      expect(viewModel.encounterImages.length).toBe(2);

      viewModel.encounterImages = [];
      viewModel.combatLog = [];

      expect(viewModel.encounterImages.length).toBe(0);
      expect(viewModel.combatLog.length).toBe(0);
    });
  });
});
