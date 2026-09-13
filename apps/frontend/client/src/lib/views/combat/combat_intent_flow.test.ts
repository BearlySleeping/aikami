// apps/frontend/client/src/lib/views/combat/combat_intent_flow.test.ts
//
// C-525 (Combat-05) ViewModel coverage for the language → preview → confirm loop.
//
//   AC-4  every compiled plan requires explicit confirmation; there is no
//         auto-commit path; cancel commits nothing; a stale plan is refused
//   AC-5  an ambiguous reading asks one bounded clarification round and the
//         chosen reading becomes the preview
//   AC-2  a superseded answer is dropped, and a refusal is typed
//
// The harness injects a recording bridge double and calls the production
// listener registration — no engine, no overlay, no network, no model.
//
// Contract: C-525 AC-2, AC-4, AC-5

import { beforeEach, describe, expect, test } from 'bun:test';
import type { GameEvent } from '@aikami/frontend/engine';
import type { ActionIntent, CombatState } from '@aikami/types';
import { createCombatState } from '@aikami/utils';
import {
  type CombatViewModelInterface,
  type CombatViewModelOptions,
  createCombatViewModel,
} from './combat_view_model.svelte.ts';
import { createCombatIntent, createCombatTestOptions } from './testing/combat_fixtures.ts';

// ── Fixtures ───────────────────────────────────────────────────────────────

const PLAYER = 'player';
const GOBLIN_1 = 'emberwatch:goblin-1';
const GOBLIN_2 = 'emberwatch:goblin-2';

const budget = {
  movementRemaining: 6,
  actionAvailable: true,
  quickActionAvailable: true,
  reactionAvailable: true,
};

const catalog: CombatState['abilityCatalog'] = {
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  basic_melee: {
    abilityId: 'basic_melee',
    name: 'Basic Melee',
    kind: 'melee_attack',
    actionCost: 'action',
    attackBonus: 2,
    damageDice: '1d6',
    damageType: 'slashing',
    rangeCells: 1,
    requiresLineOfSight: false,
  },
};

const combatant = (
  combatantId: string,
  overrides: Partial<CombatState['combatants'][string]> = {},
): CombatState['combatants'][string] => ({
  combatantId,
  name: combatantId,
  team: 'enemy',
  position: { x: 1, y: 0 },
  hp: 10,
  maxHp: 10,
  armorClass: 12,
  attackBonus: 3,
  initiative: 10,
  abilityIds: ['basic_melee'],
  budget,
  downed: false,
  defeated: false,
  ...overrides,
});

/**
 * Hero at (0,0) with a hostile adjacent. `ambiguous` adds a second hostile at
 * the same distance, which is the AC-5 clarification case.
 */
const makeState = (ambiguous: boolean): CombatState =>
  createCombatState({
    encounterId: 'emberwatch/proof_encounter',
    rulesVersion: 'combat-2.0.0',
    seed: 5,
    combatants: [
      combatant(PLAYER, {
        name: 'Hero',
        team: 'player',
        position: { x: 0, y: 0 },
        initiative: 20,
      }),
      combatant(GOBLIN_1, { name: 'Goblin Scout', position: { x: 1, y: 0 } }),
      ...(ambiguous
        ? [combatant(GOBLIN_2, { name: 'Goblin Archer', position: { x: 0, y: 1 } })]
        : []),
    ],
    abilityCatalog: catalog,
    battlefield: { width: 6, height: 6, blockedCells: [] },
    objectives: [],
  });

const nearestHostileStrike = (): ActionIntent => ({
  intentId: 'intent-1',
  encounterId: 'emberwatch/proof_encounter',
  actorId: PLAYER,
  basedOnRevision: 0,
  source: 'player_language',
  steps: [
    {
      kind: 'use_ability',
      ability: { kind: 'tag', value: 'basic_melee' },
      target: { kind: 'nearest_hostile' },
    },
  ],
});

type BridgeDouble = {
  send: (command: Record<string, unknown>) => void;
  on: (type: string, handler: (event: never) => void) => () => void;
};

const createHarness = (overrides: Partial<CombatViewModelOptions> = {}) => {
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, (event: never) => void>();
  const bridge: BridgeDouble = {
    send: (command) => {
      sent.push(command);
    },
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {};
    },
  };
  const viewModel = createCombatViewModel(createCombatTestOptions(overrides));
  (viewModel as unknown as { _bridge: BridgeDouble })._bridge = bridge;
  (viewModel as unknown as { _registerListeners: () => void })._registerListeners();

  const emit = (event: GameEvent): void => {
    const handler = handlers.get(event.type);
    if (handler) {
      (handler as (value: GameEvent) => void)(event);
    }
  };
  return { viewModel, sent, emit };
};

const beginCombat = (target: ReturnType<typeof createHarness>): void => {
  target.emit({
    type: 'COMBAT_STARTED',
    participantIds: [1, 2, 3],
    firstTurnEntityId: 1,
    encounterId: 'emberwatch/proof_encounter',
    engine: 'v2',
  } as GameEvent);
  target.emit({
    type: 'TURN_CHANGED',
    currentEntityId: 1,
    activeEntities: [1, 2, 3],
    stateRevision: 0,
  } as GameEvent);
};

const actionsOf = (sent: Array<Record<string, unknown>>) =>
  sent.filter((command) => command.type === 'COMBAT_ACTION' || command.type === 'COMBAT_MOVE');

/** Submits language and answers with the state snapshot the compiler grounds on. */
const submitAndResolve = (target: ReturnType<typeof createHarness>, state: CombatState): void => {
  target.viewModel.submitLanguageIntent('attack the nearest enemy');
  const requestId = target.sent.find(
    (command) => command.type === 'COMBAT_STATE_SNAPSHOT_REQUESTED',
  )?.requestId as string;
  target.emit({ type: 'COMBAT_STATE_SNAPSHOT', requestId, state } as GameEvent);
};

/** Waits for the (async) interpretation + compilation to settle. */
const waitForDecision = async (viewModel: CombatViewModelInterface): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!viewModel.isIntentPending) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

let harness: ReturnType<typeof createHarness>;

beforeEach(() => {
  harness = createHarness({
    intent: createCombatIntent({
      enabled: true,
      interpretWithFallback: async () => ({ ok: true, intent: nearestHostileStrike() }),
    }),
  });
});

// ── AC-4: nothing commits before an explicit confirmation ──────────────────

describe('C-525 AC-4: the preview/confirm flow is explicit', () => {
  test('submitting language commits nothing and exposes a preview instead', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    expect(actionsOf(harness.sent)).toEqual([]);
    expect(harness.viewModel.intentDecision.status).toBe('awaiting_confirmation');
    expect(harness.viewModel.intentPreview).not.toBeNull();
    expect(harness.viewModel.intentPreview?.requiresConfirmation).toBe(true);
  });

  test('the preview carries the compiled plan numbers', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    const preview = harness.viewModel.intentPreview;
    expect(preview?.commandKind).toBe('useAbility');
    expect(preview?.damageMinimum).toBe(1);
    expect(preview?.damageMaximum).toBe(6);
    expect(preview?.hitPercentage).toBeGreaterThan(0);
  });

  test('the language submission announces the decision to the engine', async () => {
    beginCombat(harness);
    harness.viewModel.submitLanguageIntent('attack the nearest enemy');

    const announced = harness.sent.filter(
      (command) => command.type === 'COMBAT_LANGUAGE_INTENT_SUBMITTED',
    );
    expect(announced).toHaveLength(1);
    expect(announced[0]?.encounterId).toBe('emberwatch/proof_encounter');
    expect(announced[0]?.basedOnRevision).toBe(0);
    expect(
      harness.sent.find((command) => command.type === 'COMBAT_STATE_SNAPSHOT_REQUESTED'),
    ).toMatchObject({ encounterId: 'emberwatch/proof_encounter' });
    expect(actionsOf(harness.sent)).toEqual([]);
  });

  test('confirming commits the compiled command through the existing v2 path', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    harness.viewModel.confirmIntentPlan();

    const actions = actionsOf(harness.sent);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      abilityId: 'basic_melee',
      targetId: GOBLIN_1,
    });
    expect(harness.viewModel.intentDecision.status).toBe('committed');
    expect(harness.viewModel.intentDecision.requestId).not.toBeNull();
    expect(harness.viewModel.intentPreview).toBeNull();
    const attemptEntry = harness.viewModel.combatLog[0];
    expect(attemptEntry).toBeDefined();
    expect(attemptEntry?.actor).toBe('You');
    expect(attemptEntry?.actionText ?? '').toContain('Basic Melee');
    expect(attemptEntry?.actionText ?? '').toContain('Goblin Scout');
  });

  test('cancelling commits nothing and clears the decision', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    harness.viewModel.cancelIntentPlan();

    expect(actionsOf(harness.sent)).toEqual([]);
    expect(harness.viewModel.intentDecision.status).toBe('idle');
  });

  test('a revision advance drops the outstanding decision', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    harness.emit({
      type: 'TURN_CHANGED',
      currentEntityId: 1,
      activeEntities: [1, 2, 3],
      stateRevision: 4,
    } as GameEvent);

    harness.viewModel.confirmIntentPlan();
    expect(actionsOf(harness.sent)).toEqual([]);
    expect(harness.viewModel.intentDecision.status).toBe('idle');
  });

  test('a command rejection after confirmation is surfaced', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    harness.viewModel.confirmIntentPlan();
    expect(harness.viewModel.intentDecision.status).toBe('committed');

    harness.emit({
      type: 'COMBAT_COMMAND_REJECTED',
      reasonCode: 'targetOutOfRange',
      messageKey: 'combat.invalid.target_out_of_range',
    } as GameEvent);

    expect(harness.viewModel.intentDecision.status).toBe('rejected');
    expect(harness.viewModel.intentDecision.rejection?.messageKey).toBe(
      'combat.invalid.target_out_of_range',
    );
  });

  test('an unresolvable instruction reports a typed rejection', async () => {
    harness = createHarness({
      intent: createCombatIntent({
        enabled: true,
        interpretWithFallback: async () => ({ ok: false, reason: 'unparseable' }),
      }),
    });
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);

    expect(actionsOf(harness.sent)).toEqual([]);
    expect(harness.viewModel.intentDecision.status).toBe('rejected');
  });

  test('the kill switch disables the language surface entirely', () => {
    harness = createHarness({ intent: createCombatIntent({ enabled: false }) });
    beginCombat(harness);
    harness.viewModel.submitLanguageIntent('attack the nearest enemy');

    expect(harness.viewModel.languageInputEnabled).toBe(false);
    expect(
      harness.sent.filter((command) => command.type === 'COMBAT_LANGUAGE_INTENT_SUBMITTED'),
    ).toEqual([]);
    expect(harness.viewModel.intentDecision.status).toBe('idle');
  });

  test('a superseded snapshot is discarded', async () => {
    beginCombat(harness);
    harness.viewModel.submitLanguageIntent('attack the nearest enemy');
    const requestId = harness.sent.find(
      (command) => command.type === 'COMBAT_STATE_SNAPSHOT_REQUESTED',
    )?.requestId as string;

    harness.viewModel.cancelIntentPlan();
    harness.emit({
      type: 'COMBAT_STATE_SNAPSHOT',
      requestId,
      state: makeState(false),
    } as GameEvent);
    await waitForDecision(harness.viewModel);

    expect(actionsOf(harness.sent)).toEqual([]);
    expect(harness.viewModel.intentDecision.status).toBe('idle');
  });

  test('a new submission cancels the prior interpretation immediately', () => {
    const cancelled: string[] = [];
    harness = createHarness({
      intent: createCombatIntent({
        enabled: true,
        cancel: (requestId) => cancelled.push(requestId),
      }),
    });
    beginCombat(harness);
    harness.viewModel.submitLanguageIntent('attack the nearest enemy');
    const firstRequestId = harness.viewModel.intentDecision.requestId;
    harness.viewModel.submitLanguageIntent('defend');

    expect(cancelled).toEqual([firstRequestId]);
    expect(harness.viewModel.intentDecision.status).toBe('interpreting');
    expect(harness.viewModel.intentDecision.requestId).not.toBe(firstRequestId);
  });

  test('a snapshot from another encounter is rejected', async () => {
    beginCombat(harness);
    harness.viewModel.submitLanguageIntent('attack the nearest enemy');
    const requestId = harness.viewModel.intentDecision.requestId;
    const mismatchedState = { ...makeState(false), encounterId: 'another-encounter' };
    harness.emit({
      type: 'COMBAT_STATE_SNAPSHOT',
      requestId,
      state: mismatchedState,
    } as GameEvent);
    await waitForDecision(harness.viewModel);

    expect(harness.viewModel.intentDecision.status).toBe('rejected');
    expect(harness.viewModel.intentDecision.rejection?.messageKey).toBe('combat.intent.stale');
  });

  test('a kernel revision clears a committed decision', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(false));
    await waitForDecision(harness.viewModel);
    harness.viewModel.confirmIntentPlan();

    harness.emit({
      type: 'TURN_CHANGED',
      currentEntityId: 1,
      activeEntities: [1, 2, 3],
      stateRevision: 1,
    } as GameEvent);

    expect(harness.viewModel.intentDecision.status).toBe('idle');
  });

  test('an ability id with a basic-melee prefix remains an ABILITY command', async () => {
    const abilityId = 'basic_melee_plus';
    harness = createHarness({
      intent: createCombatIntent({
        enabled: true,
        interpretWithFallback: async () => ({
          ok: true,
          intent: {
            ...nearestHostileStrike(),
            steps: [
              {
                kind: 'use_ability',
                ability: { kind: 'tag', value: abilityId },
                target: { kind: 'nearest_hostile' },
              },
            ],
          },
        }),
      }),
    });
    const snapshot = makeState(false);
    snapshot.abilityCatalog[abilityId] = {
      ...catalog.basic_melee,
      abilityId,
      name: 'Basic Melee Plus',
    };
    const player = snapshot.combatants[PLAYER];
    if (player === undefined) {
      throw new Error('expected player');
    }
    player.abilityIds = [abilityId];
    beginCombat(harness);
    submitAndResolve(harness, snapshot);
    await waitForDecision(harness.viewModel);
    harness.viewModel.confirmIntentPlan();

    expect(actionsOf(harness.sent)[0]).toMatchObject({
      action: 'ABILITY',
      abilityId,
    });
  });

  test('resolved kernel narration uses a neutral combat-log actor', () => {
    beginCombat(harness);
    harness.emit({
      type: 'COMBAT_EVENTS_RESOLVED',
      events: [
        {
          encounterId: 'emberwatch/proof_encounter',
          turnId: 'turn-1',
          stateRevision: 1,
          round: 1,
          kind: 'attackRolled',
          attackerId: PLAYER,
          targetId: GOBLIN_1,
          abilityId: 'basic_melee',
          naturalRoll: 3,
          totalRoll: 5,
          hit: false,
          isCriticalHit: false,
        },
      ],
      names: { [PLAYER]: 'Hero', [GOBLIN_1]: 'Goblin Scout' },
    } as GameEvent);

    expect(harness.viewModel.combatLog[0]).toMatchObject({
      actor: 'System',
      actionText: expect.stringContaining('misses'),
    });
  });

  test('resolves compiler message keys through localized copy', () => {
    expect(harness.viewModel.translateIntentMessage('combat.invalid.target_out_of_range')).toBe(
      'That target is out of range.',
    );
    expect(harness.viewModel.translateIntentMessage('unknown.key')).toBe(
      'That instruction was refused.',
    );
  });

  test('oversized text is refused before any engine round trip', () => {
    beginCombat(harness);
    harness.viewModel.submitLanguageIntent('a'.repeat(5000));

    expect(harness.viewModel.intentDecision.status).toBe('rejected');
    expect(harness.viewModel.intentDecision.rejection?.messageKey).toBe('combat.intent.too_long');
    expect(
      harness.sent.filter((command) => command.type === 'COMBAT_LANGUAGE_INTENT_SUBMITTED'),
    ).toEqual([]);
  });
});

// ── AC-5: clarification ────────────────────────────────────────────────────

describe('C-525 AC-5: clarification asks only when readings differ', () => {
  test('two equally near hostiles produce one bounded clarification round', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(true));
    await waitForDecision(harness.viewModel);

    const decision = harness.viewModel.intentDecision;
    expect(decision.status).toBe('clarifying');
    expect(decision.clarification?.options).toHaveLength(2);
    expect(decision.clarification?.options.map((option) => option.optionId)).toEqual([
      'option-1',
      'option-2',
    ]);
    expect(actionsOf(harness.sent)).toEqual([]);
  });

  test('choosing a reading previews that reading and still requires confirmation', async () => {
    beginCombat(harness);
    submitAndResolve(harness, makeState(true));
    await waitForDecision(harness.viewModel);

    const second = harness.viewModel.intentDecision.clarification?.options[1]?.optionId;
    if (second === undefined) {
      throw new Error('expected a second clarification option');
    }
    harness.viewModel.chooseIntentClarification(second);

    expect(harness.viewModel.intentDecision.status).toBe('awaiting_confirmation');
    expect(actionsOf(harness.sent)).toEqual([]);

    harness.viewModel.confirmIntentPlan();
    expect(actionsOf(harness.sent)[0]?.targetId).toBe(GOBLIN_2);
  });
});
