// apps/frontend/client/src/lib/views/combat/combat_object_inspector.test.ts
//
// C-531 AC-1 / AC-2 / AC-4: the object inspector lists what the actor can
// actually do (and why the rest is unavailable), previews without committing,
// and only sends a command on an explicit confirmation.
//
// Contract: C-531 AC-1, AC-2, AC-4

import { describe, expect, it } from 'bun:test';
import type { CombatEnvironmentBundle, CombatState } from '@aikami/types';
import { COMBAT_RULES_VERSION, createCombatState } from '@aikami/utils';
import {
  CombatObjectInspector,
  type CombatObjectInspectorBridge,
  inspectedCommand,
  inspectedObjectsFromState,
} from './combat_object_inspector.svelte.ts';

const ENCOUNTER_ID = 'emberwatch-env-1';
const ACTOR_ID = 'player';
const BRAZIER = 'emberwatch/brazier-1';
const SUPPORT = 'emberwatch/support-1';

const BUNDLE: CombatEnvironmentBundle = {
  bundleVersion: 1,
  rulesVersion: 'combat-environment-1.0.0',
  objectDefinitions: {
    'emberwatch/brazier': {
      definitionId: 'emberwatch/brazier',
      name: 'Brazier',
      durability: 4,
      blocksMovement: true,
      blocksSight: false,
      cover: 'none',
      affordanceIds: ['tip_over'],
    },
    'emberwatch/support': {
      definitionId: 'emberwatch/support',
      name: 'Rotting Support',
      durability: 3,
      blocksMovement: true,
      blocksSight: false,
      cover: 'half',
      affordanceIds: ['cut_support'],
    },
  },
  affordances: {
    tip_over: {
      affordanceId: 'tip_over',
      name: 'Tip over',
      actionCost: 'action',
      requirements: [{ kind: 'adjacent', value: true }],
      check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
      successEffects: [
        {
          kind: 'createSurface',
          surfaceKind: 'fire',
          cellSelector: 'sourceFootprint',
          expiresAfterRound: null,
        },
        { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
      ],
      failureEffects: [],
    },
    cut_support: {
      affordanceId: 'cut_support',
      name: 'Cut the support',
      actionCost: 'action',
      requirements: [{ kind: 'adjacent', value: true }],
      check: { category: 'athletics', dc: 13, modifierSource: 'athletics' },
      successEffects: [
        { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
        { kind: 'dropPayload', objectSelector: 'source', impactZone: 'zone' },
      ],
      failureEffects: [],
    },
  },
  impactZones: {
    zone: {
      zoneId: 'zone',
      offsets: [{ x: 0, y: 0 }],
      diceExpression: '2d6',
      damageType: 'bludgeoning',
    },
  },
};

const state = (): CombatState =>
  createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 11,
    combatants: [
      {
        combatantId: ACTOR_ID,
        name: 'Mara',
        team: 'player',
        position: { x: 2, y: 2 },
        hp: 20,
        maxHp: 20,
        armorClass: 12,
        attackBonus: 3,
        initiative: 10,
        abilityIds: [],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
        checkModifiers: { athletics: 3 },
      },
    ],
    abilityCatalog: {},
    battlefield: { width: 10, height: 10, blockedCells: [] },
    environment: {
      objects: {
        [BRAZIER]: {
          objectId: BRAZIER,
          definitionId: 'emberwatch/brazier',
          position: { x: 1, y: 2 },
          footprint: [{ x: 0, y: 0 }],
          durability: 4,
          state: 'intact',
          ignited: false,
          cover: 'none',
          affordanceIds: ['tip_over'],
          attachedToObjectId: null,
        },
        [SUPPORT]: {
          objectId: SUPPORT,
          definitionId: 'emberwatch/support',
          position: { x: 6, y: 6 },
          footprint: [{ x: 0, y: 0 }],
          durability: 3,
          state: 'intact',
          ignited: false,
          cover: 'half',
          affordanceIds: ['cut_support'],
          attachedToObjectId: null,
        },
      },
      surfaces: [],
      hazardTickStamps: [],
    },
    environmentBundle: BUNDLE,
  });

type SentCommand = Record<string, unknown>;

const harness = (initial: CombatState) => {
  const sent: SentCommand[] = [];
  let revision = initial.stateRevision;
  const bridge: CombatObjectInspectorBridge = {
    send: (command) => {
      sent.push(command as unknown as SentCommand);
    },
    on: () => () => {},
  } as unknown as CombatObjectInspectorBridge;

  const inspector = new CombatObjectInspector({
    bridge: () => bridge,
    readRevision: () => revision,
    readEncounterId: () => ENCOUNTER_ID,
    readActorId: () => ACTOR_ID,
  });
  return { inspector, sent, setRevision: (next: number) => (revision = next) };
};

describe('inspectedObjectsFromState (C-531 AC-1)', () => {
  it('lists every authored object in stable id order with its affordances', () => {
    const rows = inspectedObjectsFromState(state());
    expect(rows.map((row) => row.objectId)).toEqual([BRAZIER, SUPPORT]);
    expect(rows[0].name).toBe('Brazier');
    expect(rows[0].affordances.map((entry) => entry.affordanceId)).toEqual(['tip_over']);
    expect(rows[1].cover).toBe('half');
  });

  it('reports a broken object as intact-affordance-unavailable rather than dropping it', () => {
    const broken = state();
    broken.environment.objects[BRAZIER].state = 'broken';
    const rows = inspectedObjectsFromState(broken);
    const brazier = rows.find((row) => row.objectId === BRAZIER);
    expect(brazier?.affordances).toHaveLength(1);
    expect(brazier?.affordances[0].available).toBe(false);
    expect(brazier?.affordances[0].unavailableMessageKey).toBe('combat.invalid.object_destroyed');
  });
});

describe('CombatObjectInspector loop (C-531 AC-2, AC-4)', () => {
  it('asks the engine for a snapshot and derives rows from the ENGINE state', () => {
    const initial = state();
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    expect(sent[0]).toMatchObject({
      type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
      encounterId: ENCOUNTER_ID,
    });
    expect(inspector.status).toBe('loading');

    const requestId = String(sent[0].requestId);
    inspector.handleStateSnapshot({ requestId, state: initial });
    expect(inspector.status).toBe('ready');
    expect(inspector.objects.map((row) => row.objectId)).toEqual([BRAZIER, SUPPORT]);
  });

  it('ignores a snapshot for a different request', () => {
    const initial = state();
    const { inspector } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: 'stale', state: initial });
    expect(inspector.objects).toEqual([]);
    expect(inspector.status).toBe('loading');
  });

  it('sends NO command while previewing', () => {
    const initial = state();
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: String(sent[0].requestId), state: initial });
    inspector.selectObject(BRAZIER);
    inspector.previewAction('tip_over');
    // Only the snapshot request so far — a preview never commits.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'COMBAT_PREVIEW_REQUESTED' });
    expect(sent.some((command) => command.type === 'COMBAT_INTERACT')).toBe(false);
  });

  it('refuses to confirm before a preview has been answered', () => {
    const initial = state();
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: String(sent[0].requestId), state: initial });
    inspector.selectObject(BRAZIER);
    inspector.previewAction('tip_over');
    expect(inspector.confirm()).toBe(false);
    expect(sent.some((command) => command.type === 'COMBAT_INTERACT')).toBe(false);
  });

  it('confirms with an id-only command after the engine answered the preview', () => {
    const initial = state();
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: String(sent[0].requestId), state: initial });
    inspector.selectObject(BRAZIER);
    inspector.previewAction('tip_over');
    const previewId = String(sent[1].requestId);
    inspector.handlePreviewReady({
      requestId: previewId,
      forecast: {
        actionCost: 'action',
        reactionRisks: [],
        objectiveEffects: [],
        warnings: ['createsHazard'],
        checkOutcome: {
          category: 'athletics',
          dc: 12,
          modifierSource: 'athletics',
          modifier: 3,
          modifierAvailable: true,
          successOdds: 0.6,
        },
        environmentalEffects: [],
        impactCells: [{ x: 1, y: 2 }],
      },
    });
    expect(inspector.status).toBe('previewed');
    expect(inspector.preview?.checkOutcome?.dc).toBe(12);
    expect(inspector.confirm()).toBe(true);
    expect(sent[2]).toEqual(
      inspectedCommand({ actorId: ACTOR_ID, objectId: BRAZIER, affordanceId: 'tip_over' }),
    );
  });

  it('rejects an unavailable action without asking the engine to preview it', () => {
    const initial = state();
    initial.environment.objects[SUPPORT].state = 'broken';
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: String(sent[0].requestId), state: initial });
    inspector.selectObject(SUPPORT);
    inspector.previewAction('cut_support');
    expect(inspector.status).toBe('rejected');
    expect(inspector.rejectionKey).toBe('combat.invalid.object_destroyed');
    expect(sent).toHaveLength(1);
  });

  it('surfaces a typed rejection when the engine refuses the preview', () => {
    const initial = state();
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: String(sent[0].requestId), state: initial });
    inspector.selectObject(SUPPORT);
    inspector.previewAction('cut_support');
    inspector.handlePreviewReady({
      requestId: String(sent[1].requestId),
      messageKey: 'combat.invalid.requirement_unmet',
    });
    expect(inspector.status).toBe('rejected');
    expect(inspector.rejectionKey).toBe('combat.invalid.requirement_unmet');
    expect(inspector.preview).toBeNull();
  });

  it('cancel discards the preview and commits nothing', () => {
    const initial = state();
    const { inspector, sent } = harness(initial);
    inspector.refresh();
    inspector.handleStateSnapshot({ requestId: String(sent[0].requestId), state: initial });
    inspector.selectObject(BRAZIER);
    inspector.previewAction('tip_over');
    inspector.handlePreviewReady({
      requestId: String(sent[1].requestId),
      forecast: { actionCost: 'action', reactionRisks: [], objectiveEffects: [], warnings: [] },
    });
    inspector.cancel();
    expect(inspector.preview).toBeNull();
    expect(inspector.selectedAffordanceId).toBeNull();
    expect(sent.some((command) => command.type === 'COMBAT_INTERACT')).toBe(false);
  });
});
