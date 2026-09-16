// apps/frontend/client/src/lib/views/combat/combat_objective_panel.test.ts
//
// C-532 AC-1: the objective panel surfaces authored objective progress and a
// declared deadline, never lists a hidden objective, and answers from the
// engine's own snapshot — a late or superseded reply is dropped.
//
// Contract: C-532 AC-1

import { describe, expect, it } from 'bun:test';
import type { CombatState, ObjectiveRules } from '@aikami/types';
import { COMBAT_RULES_VERSION, createCombatState } from '@aikami/utils';
import {
  type CombatObjectivePanelDeps,
  getCombatObjectivePanelViewModel,
} from './combat_objective_panel.svelte.ts';
import { projectObjectivePanel } from './utils/objective_panel.ts';

const ENCOUNTER_ID = 'emberwatch-1';
const PLAYER_ID = 'player';

const RULES: ObjectiveRules = {
  definitions: [
    {
      objectiveId: 'objective.stop_ritual',
      kind: 'interact_before_deadline',
      required: true,
      hidden: false,
      rule: {
        kind: 'interact_before_deadline',
        objectId: 'emberwatch/brazier-1',
        affordanceId: 'tip_over',
        deadlineRound: 3,
        requiredActorIds: [PLAYER_ID],
      },
    },
    {
      objectiveId: 'objective.survive',
      kind: 'survive_rounds',
      required: false,
      hidden: false,
      rule: { kind: 'survive_rounds', rounds: 3, requiredActorIds: [PLAYER_ID] },
    },
    {
      objectiveId: 'objective.secret',
      kind: 'reach_zone',
      required: false,
      hidden: true,
      rule: {
        kind: 'reach_zone',
        zoneId: 'emberwatch/secret',
        cells: [{ x: 1, y: 1 }],
        requiredActorIds: [PLAYER_ID],
      },
    },
  ],
  protectedActorIds: [],
};

const stateWith = (overrides: Partial<CombatState> = {}): CombatState => {
  const base = createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 7,
    combatants: [
      {
        combatantId: PLAYER_ID,
        name: 'Hero',
        team: 'player',
        position: { x: 0, y: 0 },
        hp: 10,
        maxHp: 10,
        armorClass: 12,
        attackBonus: 2,
        initiative: 10,
        abilityIds: ['basic_melee'],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
    ],
    abilityCatalog: {},
    battlefield: { width: 8, height: 8, blockedCells: [] },
    objectiveRules: RULES,
  });
  return { ...base, ...overrides };
};

describe('AC-1 objective panel projection', () => {
  it('lists authored visible objectives and omits the hidden one', () => {
    const rows = projectObjectivePanel({ state: stateWith() });
    expect(rows.map((row) => row.objectiveId)).toEqual([
      'objective.stop_ritual',
      'objective.survive',
    ]);
  });

  it('states the declared deadline and the required flag', () => {
    const rows = projectObjectivePanel({ state: stateWith() });
    const ritual = rows.find((row) => row.objectiveId === 'objective.stop_ritual');
    expect(ritual).toMatchObject({
      kind: 'interact_before_deadline',
      status: 'pending',
      deadlineRound: 3,
      required: true,
      target: 1,
    });
    expect(ritual?.accessibleLabel).toContain('deadline round 3');
    expect(ritual?.accessibleLabel).toContain('required');
    expect(ritual?.accessibleLabel).toContain('in progress');
  });

  it('does not state a deadline for an objective that declares none', () => {
    const rows = projectObjectivePanel({ state: stateWith() });
    const survive = rows.find((row) => row.objectiveId === 'objective.survive');
    expect(survive?.deadlineRound).toBeNull();
    expect(survive?.accessibleLabel).not.toContain('deadline');
  });

  it('reports the count target for a counting primitive', () => {
    const rows = projectObjectivePanel({ state: stateWith() });
    const survive = rows.find((row) => row.objectiveId === 'objective.survive');
    expect(survive?.target).toBe(3);
  });

  it('reflects committed progress and status from the state', () => {
    const state = stateWith({
      objectives: [
        {
          objectiveId: 'objective.stop_ritual',
          kind: 'interact_before_deadline',
          status: 'complete',
          progress: 1,
        },
        {
          objectiveId: 'objective.survive',
          kind: 'survive_rounds',
          status: 'pending',
          progress: 2,
        },
      ],
    });
    const rows = projectObjectivePanel({ state });
    expect(rows[0]).toMatchObject({ status: 'complete', progress: 1 });
    expect(rows[0].accessibleLabel).toContain('complete');
    expect(rows[1]).toMatchObject({ status: 'pending', progress: 2 });
    expect(rows[1].accessibleLabel).toContain('2 of 3');
  });

  it('uses the authored display label when one exists', () => {
    const rows = projectObjectivePanel({
      state: stateWith(),
      labels: { 'objective.stop_ritual': 'Stop the ritual' },
    });
    expect(rows[0].label).toBe('Stop the ritual');
    expect(rows[0].accessibleLabel).toContain('Stop the ritual');
  });

  it('falls back to the id rather than dropping an unnamed objective', () => {
    const rows = projectObjectivePanel({ state: stateWith() });
    expect(rows[0].label).toBe('objective.stop_ritual');
  });

  it('shows nothing when the encounter authors no objectives', () => {
    const state = createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 7,
      combatants: [],
      abilityCatalog: {},
      battlefield: { width: 8, height: 8, blockedCells: [] },
    });
    expect(projectObjectivePanel({ state })).toEqual([]);
  });

  it('is deterministic', () => {
    const state = stateWith();
    expect(projectObjectivePanel({ state })).toEqual(projectObjectivePanel({ state }));
  });
});

// ---------------------------------------------------------------------------
// Flow: request / response cycle
// ---------------------------------------------------------------------------

type Harness = {
  panel: CombatObjectivePanel;
  sent: Array<Record<string, unknown>>;
  emit(type: string, payload: Record<string, unknown>): void;
  detach(): void;
};

const harness = (): Harness => {
  const listeners = new Map<string, Array<(event: never) => void>>();
  const sent: Array<Record<string, unknown>> = [];
  const bridge = {
    send: (command: unknown) => {
      sent.push(command as Record<string, unknown>);
    },
    on: (type: string, handler: (event: never) => void) => {
      const bucket = listeners.get(type) ?? [];
      bucket.push(handler);
      listeners.set(type, bucket);
      return () => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== handler),
        );
      };
    },
  };
  const deps: CombatObjectivePanelDeps = {
    bridge: () => bridge as never,
    readEncounterId: () => ENCOUNTER_ID,
  };
  const panel = getCombatObjectivePanelViewModel({
    ...deps,
    className: 'CombatObjectivePanelTest',
    snapshotDeadlineMs: 50,
  });
  const detach = panel.attach();
  return {
    panel,
    sent,
    emit: (type, payload) => {
      for (const handler of listeners.get(type) ?? []) {
        (handler as (event: unknown) => void)(payload);
      }
    },
    detach,
  };
};

describe('AC-1 objective panel flow', () => {
  it('requests one snapshot after a committed command', () => {
    const h = harness();
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
      encounterId: ENCOUNTER_ID,
    });
    h.detach();
  });

  it('projects the answer to the request it is waiting for', () => {
    const h = harness();
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    const requestId = h.sent[0].requestId as string;
    h.emit('COMBAT_STATE_SNAPSHOT', { requestId, state: stateWith() });
    expect(h.panel.objectives.map((row) => row.objectiveId)).toEqual([
      'objective.stop_ritual',
      'objective.survive',
    ]);
    h.detach();
  });

  it('drops a late reply to a superseded request', () => {
    const h = harness();
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    const staleId = h.sent[0].requestId as string;
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    h.emit('COMBAT_STATE_SNAPSHOT', { requestId: staleId, state: stateWith() });
    expect(h.panel.objectives).toEqual([]);
    h.detach();
  });

  it('never lists a hidden objective through the flow either', () => {
    const h = harness();
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    const requestId = h.sent[0].requestId as string;
    h.emit('COMBAT_STATE_SNAPSHOT', { requestId, state: stateWith() });
    expect(h.panel.objectives.some((row) => row.objectiveId === 'objective.secret')).toBe(false);
    h.detach();
  });

  it('keeps the panel empty when the engine has no v2 state', () => {
    const h = harness();
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    const requestId = h.sent[0].requestId as string;
    h.emit('COMBAT_STATE_SNAPSHOT_REJECTED', {
      requestId,
      reasonCode: 'encounterEnded',
      messageKey: 'x',
    });
    expect(h.panel.objectives).toEqual([]);
    h.detach();
  });

  it('clears the panel when the encounter ends', () => {
    const h = harness();
    h.emit('COMBAT_EVENTS_RESOLVED', { events: [], names: {} });
    const requestId = h.sent[0].requestId as string;
    h.emit('COMBAT_STATE_SNAPSHOT', { requestId, state: stateWith() });
    expect(h.panel.objectives.length).toBeGreaterThan(0);
    h.emit('COMBAT_ENDED', { victory: true, reason: 'all_enemies_defeated' });
    expect(h.panel.objectives).toEqual([]);
    h.detach();
  });

  it('does not send a request when there is no encounter id', () => {
    const listeners = new Map<string, Array<(event: never) => void>>();
    const sent: unknown[] = [];
    const panel = getCombatObjectivePanelViewModel({
      className: 'CombatObjectivePanelTest',
      bridge: () =>
        ({
          send: (command: unknown) => sent.push(command),
          on: (type: string, handler: (event: never) => void) => {
            const bucket = listeners.get(type) ?? [];
            bucket.push(handler);
            listeners.set(type, bucket);
            return () => {};
          },
        }) as never,
      readEncounterId: () => '',
      snapshotDeadlineMs: 50,
    });
    panel.attach();
    panel.requestRefresh();
    expect(sent).toEqual([]);
  });
});
