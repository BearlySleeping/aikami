// apps/frontend/client/src/lib/views/combat/combat_v2_view_model.test.ts
//
// C-516 (Combat-04) direct-control ViewModel coverage.
//
//   AC-7  the preview loop is live and stale-safe
//   AC-9  ability and target selection commit through v2 without sending
//         mechanical numbers
//
// The harness injects a recording bridge double (`send` captures commands,
// `on` captures handlers so replies can be driven from the test) and calls the
// production listener registration — no engine, no overlay, no network.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/combat_v2_view_model.test.ts
//
// Contract: C-516 AC-7, AC-9

import { beforeEach, describe, expect, test } from 'bun:test';
import type { GameEvent } from '@aikami/frontend/engine';
import {
  type CombatViewModelInterface,
  type CombatViewModelOptions,
  createCombatViewModel,
} from './combat_view_model.svelte.ts';
import { createCombatTestOptions } from './testing/combat_fixtures.ts';

type BridgeDouble = {
  send: (command: Record<string, unknown>) => void;
  on: (type: string, handler: (event: never) => void) => () => void;
};

const createHarness = (overrides: Partial<CombatViewModelOptions> = {}) => {
  const viewModel = createCombatViewModel(createCombatTestOptions(overrides));
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

  (viewModel as unknown as { _bridge: BridgeDouble })._bridge = bridge;
  (viewModel as unknown as { _registerListeners: () => void })._registerListeners();

  const emit = (event: GameEvent): void => {
    const handler = handlers.get(event.type);
    if (handler) {
      (handler as (value: GameEvent) => void)(event);
    }
  };

  return { viewModel, sent, emit, handlers };
};

const beginCombat = (target: ReturnType<typeof createHarness>): void => {
  target.emit({
    type: 'COMBAT_STARTED',
    participantIds: [1, 2],
    firstTurnEntityId: 1,
    encounterId: 'emberwatch/proof_encounter',
    engine: 'v2',
  } as GameEvent);
  target.emit({
    type: 'TURN_CHANGED',
    currentEntityId: 1,
    activeEntities: [1, 2],
    stateRevision: 0,
  } as GameEvent);
};

const previewRequests = (sent: Array<Record<string, unknown>>) =>
  sent.filter((command) => command.type === 'COMBAT_PREVIEW_REQUESTED');

let harness: ReturnType<typeof createHarness>;

beforeEach(() => {
  harness = createHarness();
});

describe('C-516 AC-7: the preview loop is live and stale-safe', () => {
  test('entering move selection sends one correlated preview request', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();

    const requests = previewRequests(harness.sent);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.encounterId).toBe('emberwatch/proof_encounter');
    expect(requests[0]?.basedOnRevision).toBe(0);
    expect(requests[0]?.query).toEqual({ kind: 'legalMoves', combatantId: 'player' });
    expect(harness.viewModel.isSelectionLoading).toBe(true);
    expect(harness.viewModel.isMoveSelection).toBe(true);
  });

  test('COMBAT_PREVIEW_READY populates endpoints, targets and the forecast', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;

    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: {
        actionCost: 'movement',
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
      legalEndpoints: [{ x: 2, y: 1 }],
      movementCostTo: { '2,1': 1 },
    } as GameEvent);

    const selection = harness.viewModel.combatSelection;
    expect(selection.status).toBe('ready');
    expect(selection.legalEndpoints).toEqual([{ x: 2, y: 1 }]);
    expect(selection.movementCostTo['2,1']).toBe(1);
    expect(selection.forecast).not.toBeNull();
    expect(harness.viewModel.isSelectionLoading).toBe(false);
  });

  test('a stale reply for a superseded request is discarded', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const staleId = previewRequests(harness.sent)[0]?.requestId as string;

    // A newer selection supersedes it before the answer lands.
    harness.viewModel.beginAbilitySelection('wizard_magic_missile');
    const currentId = previewRequests(harness.sent)[1]?.requestId as string;
    expect(currentId).not.toBe(staleId);

    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId: staleId,
      forecast: {
        actionCost: 'movement',
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
      legalEndpoints: [{ x: 9, y: 9 }],
    } as GameEvent);

    // The stale reply did not repaint the newer selection.
    expect(harness.viewModel.combatSelection.mode).toBe('target');
    expect(harness.viewModel.combatSelection.legalEndpoints).toEqual([]);
    expect(harness.viewModel.isSelectionLoading).toBe(true);
  });

  test('switching mode cancels the outstanding request', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    expect(harness.viewModel.isMoveSelection).toBe(true);

    harness.viewModel.cancelSelection();
    expect(harness.viewModel.combatSelection.mode).toBe('idle');
    expect(harness.viewModel.combatSelection.requestId).toBeNull();
  });

  test('a rejection surfaces as a typed reason with no endpoints', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;

    harness.emit({
      type: 'COMBAT_PLAN_REJECTED',
      requestId,
      reasonCode: 'notActiveCombatant',
      messageKey: 'combat.invalid.not_active_combatant',
    } as GameEvent);

    expect(harness.viewModel.combatSelection.status).toBe('rejected');
    expect(harness.viewModel.selectionRejection).toBe('combat.invalid.not_active_combatant');
    expect(harness.viewModel.combatSelection.forecast).toBeNull();
  });

  test('a new turn invalidates an open selection', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    expect(harness.viewModel.isMoveSelection).toBe(true);

    harness.emit({
      type: 'TURN_CHANGED',
      currentEntityId: 2,
      activeEntities: [1, 2],
      stateRevision: 1,
    } as GameEvent);

    expect(harness.viewModel.combatSelection.mode).toBe('idle');
  });

  test('a revision advance invalidates an outstanding preview on the player turn', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const staleId = previewRequests(harness.sent)[0]?.requestId as string;

    harness.emit({
      type: 'TURN_CHANGED',
      currentEntityId: 1,
      activeEntities: [1, 2],
      stateRevision: 1,
    } as GameEvent);
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId: staleId,
      forecast: { actionCost: 'movement', reactionRisks: [], objectiveEffects: [], warnings: [] },
      legalEndpoints: [{ x: 9, y: 9 }],
    } as GameEvent);

    expect(harness.viewModel.combatSelection.mode).toBe('idle');
    expect(harness.viewModel.combatSelection.requestId).toBeNull();
    expect(harness.viewModel.combatSelection.basedOnRevision).toBe(1);
    expect(harness.viewModel.combatSelection.legalEndpoints).toEqual([]);
  });

  test('previews never mutate engine state — only preview commands are sent', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    harness.viewModel.beginAbilitySelection('basic_melee');
    const committed = harness.sent.filter(
      (command) => command.type === 'COMBAT_ACTION' || command.type === 'COMBAT_MOVE',
    );
    expect(committed).toHaveLength(0);
  });
});

describe('C-516 AC-9: ability and target selection commit through v2', () => {
  test('the ability picker is catalog-derived and never offers an unknown ability', () => {
    const abilities = harness.viewModel.availableAbilities;
    expect(abilities.length).toBeGreaterThan(1);
    expect(abilities.map((ability) => ability.abilityId)).toContain('basic_melee');
  });

  test('picking an ability sends a legalTargets preview', () => {
    beginCombat(harness);
    harness.viewModel.beginAbilitySelection('basic_melee');
    const requests = previewRequests(harness.sent);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.query).toEqual({
      kind: 'legalTargets',
      combatantId: 'player',
      abilityId: 'basic_melee',
    });
    expect(harness.viewModel.isTargetSelection).toBe(true);

    const requestId = requests[0]?.requestId as string;
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: {
        actionCost: 'action',
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
      legalTargetIds: ['2'],
    } as GameEvent);
    expect(harness.viewModel.combatSelection.legalTargetIds).toEqual(['2']);
  });

  test('committing an ability sends only ids — never a damage number', () => {
    beginCombat(harness);
    harness.viewModel.beginAbilitySelection('basic_melee');
    harness.viewModel.selectTarget('2');
    harness.viewModel.commitSelection();

    const action = harness.sent.find((command) => command.type === 'COMBAT_ACTION');
    expect(action).toBeDefined();
    expect(action?.action).toBe('ABILITY');
    expect(action?.abilityId).toBe('basic_melee');
    expect(action?.targetId).toBe(2);
    const keys = Object.keys(action ?? {});
    for (const forbidden of ['damage', 'damageDice', 'bonusDamage', 'advantage']) {
      expect(keys).not.toContain(forbidden);
    }
    // Committing clears the selection.
    expect(harness.viewModel.combatSelection.mode).toBe('idle');
  });

  test('committing a basic attack sends ATTACK with no ability id', () => {
    beginCombat(harness);
    harness.viewModel.selectAbility(null);
    harness.viewModel.selectTarget('2');
    harness.viewModel.commitSelection();

    const action = harness.sent.find((command) => command.type === 'COMBAT_ACTION');
    expect(action?.action).toBe('ATTACK');
    expect(action?.abilityId).toBeUndefined();
  });

  test('Defend is available with no target', () => {
    beginCombat(harness);
    // No selection at all — Defend needs no target and no preview.
    expect(harness.viewModel.combatSelection.selectedTargetId).toBeNull();
    expect(harness.viewModel.availableAbilities.length).toBeGreaterThan(0);
    // Cancelling an idle selection is a no-op, never a throw.
    harness.viewModel.cancelSelection();
    expect(harness.viewModel.combatSelection.mode).toBe('idle');
    harness.viewModel.defend();
    expect(harness.sent.find((command) => command.type === 'COMBAT_ACTION')).toMatchObject({
      type: 'COMBAT_ACTION',
      action: 'DEFEND',
    });
  });

  /**
   * Picks a target and answers the `legalTargets` query the way the engine does:
   * legality only, with an empty forecast.
   */
  const pickTarget = (targetId: string): string => {
    harness.viewModel.beginAbilitySelection('basic_melee');
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: { actionCost: 'action', reactionRisks: [], objectiveEffects: [], warnings: [] },
      legalTargetIds: [targetId],
    } as GameEvent);
    harness.viewModel.selectTarget(targetId);
    return requestId;
  };

  test('picking a target asks the engine to forecast the committed command', () => {
    beginCombat(harness);
    pickTarget('2');

    const requests = previewRequests(harness.sent);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.query).toEqual({
      kind: 'action',
      combatantId: 'player',
      command: {
        kind: 'useAbility',
        combatantId: 'player',
        abilityId: 'basic_melee',
        targetIds: ['2'],
      },
    });
  });

  test('the forecast reply fills the panel without erasing the legal targets', () => {
    beginCombat(harness);
    pickTarget('2');
    const forecastId = previewRequests(harness.sent)[1]?.requestId as string;

    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId: forecastId,
      forecast: {
        actionCost: 'action',
        hitChance: 0.65,
        damageRange: { minimum: 3, maximum: 9 },
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
    } as GameEvent);

    const selection = harness.viewModel.combatSelection;
    // The numbers the panel renders.
    expect(selection.forecast?.hitChance).toBe(0.65);
    expect(harness.viewModel.forecastHitPercentage).toBe(65);
    expect(selection.forecast?.damageRange).toEqual({ minimum: 3, maximum: 9 });
    // The set the player is choosing from survives the follow-up query.
    expect(selection.legalTargetIds).toEqual(['2']);
    expect(selection.selectedTargetId).toBe('2');
    expect(harness.viewModel.isSelectionLoading).toBe(false);
  });

  test('a forecast for the wrong target is superseded, never painted over the new one', () => {
    beginCombat(harness);
    pickTarget('2');
    const staleForecastId = previewRequests(harness.sent)[1]?.requestId as string;

    harness.viewModel.selectTarget('3');
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId: staleForecastId,
      forecast: {
        actionCost: 'action',
        hitChance: 0.01,
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
    } as GameEvent);

    expect(harness.viewModel.combatSelection.forecast?.hitChance).toBeUndefined();
    expect(harness.viewModel.combatSelection.selectedTargetId).toBe('3');
  });

  test('a basic attack with no ability picked forecasts basic_melee, the id ATTACK resolves to', () => {
    beginCombat(harness);
    harness.viewModel.selectAbility(null);
    harness.viewModel.selectTarget('4');

    const forecast = previewRequests(harness.sent).at(-1);
    expect(forecast?.query).toMatchObject({
      kind: 'action',
      command: { abilityId: 'basic_melee', targetIds: ['4'] },
    });
  });

  test('a legacy encounter never sends the v2-only action forecast', () => {
    harness.emit({
      type: 'COMBAT_STARTED',
      participantIds: [1, 2],
      firstTurnEntityId: 1,
      encounterId: 'legacy_encounter',
      engine: 'legacy',
    } as GameEvent);

    harness.viewModel.beginAbilitySelection('basic_melee');
    harness.viewModel.selectTarget('2');

    const queries = previewRequests(harness.sent).map(
      (request) => (request.query as { kind?: string }).kind,
    );
    expect(queries).toEqual(['legalTargets']);
    expect(harness.viewModel.combatSelection.selectedTargetId).toBe('2');
  });
});

describe('C-516 AC-8: pointer click-to-move commits a budgeted v2 move', () => {
  test('clicking a reachable endpoint sends COMBAT_MOVE with the cell', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: {
        actionCost: 'movement',
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
      legalEndpoints: [{ x: 2, y: 1 }],
      movementCostTo: { '2,1': 1 },
    } as GameEvent);

    harness.viewModel.commitMoveToCell({ x: 2, y: 1 });

    const move = harness.sent.find((command) => command.type === 'COMBAT_MOVE');
    expect(move).toMatchObject({ type: 'COMBAT_MOVE', cellX: 2, cellY: 1 });
    // Never the explore locomotion command.
    expect(harness.sent.some((command) => command.type === 'MOVE_TO_CELL')).toBe(false);
    expect(harness.viewModel.combatSelection.mode).toBe('idle');
  });

  test('a canvas move request validates and commits through the ViewModel', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: { actionCost: 'movement', reactionRisks: [], objectiveEffects: [], warnings: [] },
      legalEndpoints: [{ x: 2, y: 1 }],
    } as GameEvent);

    harness.emit({ type: 'COMBAT_MOVE_REQUESTED', cellX: 2, cellY: 1 } as GameEvent);

    expect(harness.sent.find((command) => command.type === 'COMBAT_MOVE')).toMatchObject({
      type: 'COMBAT_MOVE',
      cellX: 2,
      cellY: 1,
    });
    expect(harness.viewModel.combatSelection.mode).toBe('idle');
  });

  test('clicking outside the reachable set does nothing', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: {
        actionCost: 'movement',
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
      legalEndpoints: [{ x: 2, y: 1 }],
    } as GameEvent);

    harness.viewModel.commitMoveToCell({ x: 7, y: 7 });
    expect(harness.sent.some((command) => command.type === 'COMBAT_MOVE')).toBe(false);
    // The selection stays open so the player can pick a legal cell.
    expect(harness.viewModel.isMoveSelection).toBe(true);
  });

  test('a move outside move-selection mode is ignored', () => {
    beginCombat(harness);
    harness.viewModel.commitMoveToCell({ x: 2, y: 1 });
    expect(harness.sent.some((command) => command.type === 'COMBAT_MOVE')).toBe(false);
  });
});

describe('C-525 R-2: the ViewModel projects highlight cells to the tactical canvas', () => {
  const highlights = (sent: Array<Record<string, unknown>>) =>
    sent.filter((command) => command.type === 'COMBAT_SELECTION_HIGHLIGHTS');

  test('a move preview emits the reachable endpoints to the engine', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;

    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: { actionCost: 'movement', reactionRisks: [], objectiveEffects: [], warnings: [] },
      legalEndpoints: [{ x: 2, y: 1 }],
    } as GameEvent);

    expect(highlights(harness.sent).at(-1)).toEqual({
      type: 'COMBAT_SELECTION_HIGHLIGHTS',
      legalEndpoints: [{ x: 2, y: 1 }],
      legalTargetCells: [],
    });
  });

  test('target cells travel with the engine-declared legal targets', () => {
    beginCombat(harness);
    harness.viewModel.beginAbilitySelection('basic_melee');
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;

    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: { actionCost: 'action', reactionRisks: [], objectiveEffects: [], warnings: [] },
      legalTargetIds: ['2'],
      legalTargetCells: [{ x: 3, y: 4 }],
    } as GameEvent);

    expect(highlights(harness.sent).at(-1)).toEqual({
      type: 'COMBAT_SELECTION_HIGHLIGHTS',
      legalEndpoints: [],
      legalTargetCells: [{ x: 3, y: 4 }],
    });
  });

  test('cancelling a selection clears the highlight overlay', () => {
    beginCombat(harness);
    harness.viewModel.beginMoveSelection();
    const requestId = previewRequests(harness.sent)[0]?.requestId as string;
    harness.emit({
      type: 'COMBAT_PREVIEW_READY',
      requestId,
      forecast: { actionCost: 'movement', reactionRisks: [], objectiveEffects: [], warnings: [] },
      legalEndpoints: [{ x: 2, y: 1 }],
    } as GameEvent);

    harness.viewModel.cancelSelection();

    expect(highlights(harness.sent).at(-1)).toEqual({
      type: 'COMBAT_SELECTION_HIGHLIGHTS',
      legalEndpoints: [],
      legalTargetCells: [],
    });
  });
});

describe('C-516 direct control — interface surface', () => {
  test('selection starts idle', () => {
    const vm: CombatViewModelInterface = createCombatViewModel(createCombatTestOptions());
    expect(vm.combatSelection.mode).toBe('idle');
    expect(vm.isMoveSelection).toBe(false);
    expect(vm.selectionRejection).toBeNull();
  });

  test('move presentation and toggle behavior are projected by the ViewModel', () => {
    beginCombat(harness);
    expect(harness.viewModel.moveButtonClasses).toContain('btn-outline');
    expect(harness.viewModel.moveButtonLabel).toBe('🥾 Move');

    harness.viewModel.toggleMoveSelection();
    expect(harness.viewModel.moveButtonClasses).toContain('btn-active');
    expect(harness.viewModel.moveButtonLabel).toBe('🥾 Cancel move');

    harness.viewModel.toggleMoveSelection();
    expect(harness.viewModel.combatSelection.mode).toBe('idle');
  });

  test('ability and target button classes are projected by the ViewModel', () => {
    beginCombat(harness);
    harness.viewModel.beginAbilitySelection('basic_melee');
    expect(harness.viewModel.abilityButtonClasses('basic_melee')).toContain('btn-primary');
    expect(harness.viewModel.abilityButtonClasses('some_other')).toContain('btn-outline');

    harness.viewModel.selectTarget('2');
    expect(harness.viewModel.targetButtonClasses('2')).toContain('btn-warning');
    expect(harness.viewModel.targetButtonClasses('3')).toContain('btn-outline');
  });

  test('the player initiative row uses the engine-reported player entity id', () => {
    harness.emit({
      type: 'COMBAT_STARTED',
      participantIds: [7, 2],
      firstTurnEntityId: 7,
      playerEntityId: 7,
      enemyId: 2,
      engine: 'v2',
    } as GameEvent);

    expect(harness.viewModel.initiativeEntries[0]?.entityId).toBe(7);
  });
});

describe('C-516 AC-5: combat logs update only their addressed combatant', () => {
  test('a secondary target updates initiative without replacing the primary enemy HP', () => {
    harness.emit({
      type: 'COMBAT_STARTED',
      participantIds: [1, 2, 3],
      firstTurnEntityId: 1,
      playerEntityId: 1,
      enemyId: 2,
      enemyHp: 40,
      enemyMaxHp: 40,
      engine: 'v2',
    } as GameEvent);

    harness.emit({
      type: 'COMBAT_LOG',
      message: 'Secondary target takes damage',
      sourceId: 1,
      targetId: 3,
      targetRemainingHp: 7,
      targetMaxHp: 12,
    } as GameEvent);

    expect(harness.viewModel.enemyHp).toBe(40);
    expect(harness.viewModel.enemyMaxHp).toBe(40);
    expect(harness.viewModel.initiativeEntries.find((entry) => entry.entityId === 3)).toMatchObject(
      {
        currentHp: 7,
        maxHp: 12,
      },
    );
  });
});
