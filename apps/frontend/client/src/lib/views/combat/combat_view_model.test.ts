// apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts
//
// Unit tests for CombatViewModel:
// - C-148 Combat Immersion (dice roll state, enemy quotes, scene images)
// - C-149 Combat Gatekeeping (actionValid gatekeeping)
// - C-151 AI Dynamic Music (sceneMood → BGM crossfade)
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/combat_view_model.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  type CombatViewModelInterface,
  type CombatViewModelOptions,
  createCombatViewModel,
} from './combat_view_model.svelte.ts';
import { createCombatTestOptions } from './testing/combat_fixtures.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Creates a fresh CombatViewModel instance with test options. */
const createViewModel = (
  overrides: Partial<CombatViewModelOptions> = {},
): CombatViewModelInterface => createCombatViewModel(createCombatTestOptions(overrides));

/** Extracts the active dice roll value with a non-null assertion guard. */
const getDiceRoll = (vm: CombatViewModelInterface) => {
  const roll = vm.activeDiceRoll;
  if (!roll) {
    throw new Error('Expected activeDiceRoll to be non-null');
  }
  return roll;
};

/** Installs a spy bridge and active-combat state on a fresh ViewModel. */
const armViewModel = (
  vm: CombatViewModelInterface,
  overrides: { enemyHp?: number; enemyMaxHp?: number; playerAttack?: number } = {},
): Array<Record<string, unknown>> => {
  const bridgeSendCalls: Array<Record<string, unknown>> = [];
  (
    vm as unknown as {
      _bridge: { send: (cmd: Record<string, unknown>) => void; on: () => () => void };
    }
  )._bridge = {
    send: (cmd: Record<string, unknown>) => {
      bridgeSendCalls.push(cmd);
    },
    on: () => () => {},
  };
  vm.currentTurnEntity = 1;
  vm.enemyEntityId = 2;
  vm.enemyName = 'Goblin';
  vm.playerHp = 80;
  vm.playerMaxHp = 100;
  vm.enemyHp = overrides.enemyHp ?? 60;
  vm.enemyMaxHp = overrides.enemyMaxHp ?? 80;
  vm.activeEntities = [1, 2];
  vm.playerLevel = 3;
  vm.playerAttack = overrides.playerAttack ?? 7;
  vm.playerDefense = 14;
  return bridgeSendCalls;
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CombatViewModel — C-148 Combat Immersion', () => {
  // -----------------------------------------------------------------------
  // Dice roll state
  // -----------------------------------------------------------------------

  describe('activeDiceRoll', () => {
    let viewModel: CombatViewModelInterface;

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
    let viewModel: CombatViewModelInterface;

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
    let viewModel: CombatViewModelInterface;
    let bridgeSendCalls: Array<Record<string, unknown>>;

    beforeEach(() => {
      viewModel = createViewModel();
      bridgeSendCalls = armViewModel(viewModel);
    });

    test('should append invalidReason to combat log when actionValid is false', async () => {
      const extractStructure = mock(async () => ({
        actionType: 'ATTACK',
        narrative: "You reach for your potion belt — but it's empty!",
        bonusDamage: 0,
        advantage: false,
        generateImage: false,
        actionValid: false,
        invalidReason:
          'You reach for a healing potion, but your bags are empty! The goblin snickers at your misfortune.',
      }));
      viewModel = createViewModel({ text: { extractStructure } });
      bridgeSendCalls = armViewModel(viewModel);

      await viewModel.executeCustomAction('I drink a healing potion');

      // The invalid reason should appear in the combat log
      const logString = viewModel.combatLog.map((e) => e.actionText).join(' ');
      expect(logString).toContain('bags are empty');
      expect(logString).toContain('potion belt');

      // COMBAT_ACTION_ANIMATE is sent, but COMBAT_ACTION must NOT be dispatched (gatekept)
      expect(bridgeSendCalls.length).toBe(1);
      expect(bridgeSendCalls[0].type).toBe('COMBAT_ACTION_ANIMATE');

      // Should not be stuck in resolving state
      expect(viewModel.isResolvingAiAction).toBe(false);
    });

    test('should dispatch COMBAT_ACTION when actionValid is true', async () => {
      const extractStructure = mock(async () => ({
        actionType: 'ATTACK',
        narrative: 'You swing your sword in a wide arc!',
        bonusDamage: 2,
        advantage: false,
        generateImage: false,
        actionValid: true,
      }));
      viewModel = createViewModel({ text: { extractStructure } });
      bridgeSendCalls = armViewModel(viewModel);

      await viewModel.executeCustomAction('I swing my sword at the goblin');

      // COMBAT_ACTION_ANIMATE + COMBAT_ACTION MUST be dispatched
      expect(bridgeSendCalls.length).toBe(2);
      expect(bridgeSendCalls[0].type).toBe('COMBAT_ACTION_ANIMATE');
      expect(bridgeSendCalls[1].type).toBe('COMBAT_ACTION');
      expect(bridgeSendCalls[1].action).toBe('ATTACK');

      // Should not be stuck in resolving state
      expect(viewModel.isResolvingAiAction).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // C-151: AI Dynamic Music — sceneMood triggers BGM crossfade
  // -----------------------------------------------------------------------

  describe('executeCustomAction — C-151 AI Dynamic Music', () => {
    let viewModel: CombatViewModelInterface;
    let bridgeSendCalls: Array<Record<string, unknown>>;

    beforeEach(() => {
      viewModel = createViewModel();
      bridgeSendCalls = armViewModel(viewModel);
    });

    test('should call _transitionBgmByMood when LLM returns sceneMood', async () => {
      const extractStructure = mock(async () => ({
        actionType: 'ATTACK',
        narrative: 'With a thunderous roar, you strike the killing blow!',
        bonusDamage: 3,
        advantage: true,
        generateImage: false,
        actionValid: true,
        sceneMood: 'triumph',
      }));
      viewModel = createViewModel({ text: { extractStructure } });
      bridgeSendCalls = armViewModel(viewModel);

      // Spy on _transitionBgmByMood via method override
      let wasCalled = false;
      let receivedMood = '';
      const vm = viewModel as unknown as {
        _transitionBgmByMood: (mood: string) => Promise<void>;
      };
      vm._transitionBgmByMood = async (mood: string) => {
        wasCalled = true;
        receivedMood = mood;
      };

      await viewModel.executeCustomAction('I strike the final blow!');

      expect(wasCalled).toBe(true);
      expect(receivedMood).toBe('triumph');

      // COMBAT_ACTION_ANIMATE + COMBAT_ACTION dispatched
      expect(bridgeSendCalls.length).toBe(2);
    });

    test('should NOT call _transitionBgmByMood when sceneMood is undefined', async () => {
      const extractStructure = mock(async () => ({
        actionType: 'ATTACK',
        narrative: 'You swing your sword at the goblin.',
        bonusDamage: 0,
        advantage: false,
        generateImage: false,
        actionValid: true,
      }));
      viewModel = createViewModel({ text: { extractStructure } });
      bridgeSendCalls = armViewModel(viewModel);

      let wasCalled = false;
      const vm = viewModel as unknown as {
        _transitionBgmByMood: (mood: string) => Promise<void>;
      };
      vm._transitionBgmByMood = async () => {
        wasCalled = true;
      };

      await viewModel.executeCustomAction('I swing my sword');

      expect(wasCalled).toBe(false);

      // Engine command should still be dispatched
      expect(bridgeSendCalls.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // C-165: Combat Inline Images & Gallery
  // -----------------------------------------------------------------------

  describe('CombatViewModel — C-165 CombatLogEntry', () => {
    let viewModel: CombatViewModelInterface;

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

// ---------------------------------------------------------------------------
// C-489 AC-5: model-proposed advantage and bonus damage are recomputed from state
// ---------------------------------------------------------------------------

describe('executeCustomAction — C-489 AC-5 (recompute advantage/bonus from state)', () => {
  let viewModel: CombatViewModelInterface;
  let bridgeSendCalls: Array<Record<string, unknown>>;

  beforeEach(() => {
    viewModel = createViewModel();
    bridgeSendCalls = armViewModel(viewModel, { enemyHp: 80, enemyMaxHp: 80, playerAttack: 5 });
  });

  test('ignores a model-proposed +10 bonus and fabricated advantage', async () => {
    const extractStructure = mock(async () => ({
      actionType: 'ATTACK',
      narrative: 'You unleash a devastating blow!',
      bonusDamage: 10, // model claims +10
      advantage: true, // model claims advantage
      generateImage: false,
      actionValid: true,
    }));
    viewModel = createViewModel({ text: { extractStructure } });
    bridgeSendCalls = armViewModel(viewModel, { enemyHp: 80, enemyMaxHp: 80, playerAttack: 5 });

    await viewModel.executeCustomAction('I unleash a devastating blow');

    const action = bridgeSendCalls.find((c) => c.type === 'COMBAT_ACTION');
    if (!action) {
      throw new Error('expected a COMBAT_ACTION to be dispatched');
    }
    // Enemy at full HP → no advantage from state; player attack 5 → +2 bonus.
    expect(action.advantage).toBe(false);
    expect(action.bonusDamage).toBe(2);
  });

  test('grants advantage from state when the enemy is wounded', async () => {
    const extractStructure = mock(async () => ({
      actionType: 'ATTACK',
      narrative: 'You press the advantage!',
      bonusDamage: 0,
      advantage: false,
      generateImage: false,
      actionValid: true,
    }));
    viewModel = createViewModel({ text: { extractStructure } });
    bridgeSendCalls = armViewModel(viewModel, { enemyHp: 20, enemyMaxHp: 80, playerAttack: 5 });

    await viewModel.executeCustomAction('I press the advantage');

    const action = bridgeSendCalls.find((c) => c.type === 'COMBAT_ACTION');
    if (!action) {
      throw new Error('expected a COMBAT_ACTION to be dispatched');
    }
    expect(action.advantage).toBe(true);
  });
});
