// apps/frontend/client/src/lib/services/game/game_save_combat_preflight.test.ts
//
// Review F-B/F7: validate → compatibility → migrate → plan, all BEFORE the
// running game is touched.
//
// Failure class 17: a corrupt or unsupported combat checkpoint is refused and
// mutates no runtime state. These tests exercise the preflight in isolation;
// `game_save_service.test.ts` proves the load ORDER through the real service.

import { describe, expect, it } from 'bun:test';
import { COMBAT_RULES_VERSION, createCombatState } from '@aikami/utils';
import { preflightCombatCheckpoint } from './game_save_combat_preflight.ts';

const validState = () =>
  createCombatState({
    encounterId: 'emberwatch/preflight',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 7,
    combatants: [
      {
        combatantId: 'player',
        name: 'Player',
        team: 'player',
        position: { x: 1, y: 1 },
        hp: 20,
        maxHp: 20,
        armorClass: 10,
        attackBonus: 3,
        initiative: 20,
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
    battlefield: { width: 4, height: 4, blockedCells: [] },
  });

const checkpoint = (state: unknown, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 4,
  rulesVersion: COMBAT_RULES_VERSION,
  encounterId: 'emberwatch/preflight',
  encounterRunId: 'run:emberwatch/preflight:r1:abc:1',
  stateRevision: 3,
  sessionRevision: 9,
  state,
  journal: null,
  initialCheckpoint: null,
  pendingReaction: null,
  settlement: null,
  actorBindings: [],
  worldObjects: null,
  ...overrides,
});

describe('preflightCombatCheckpoint: absent blocks are not failures', () => {
  it('treats a missing block as no live encounter', () => {
    expect(preflightCombatCheckpoint({ checkpoint: undefined })).toEqual({ ok: true, plan: null });
    expect(preflightCombatCheckpoint({ checkpoint: null })).toEqual({ ok: true, plan: null });
  });

  it('treats a block with no live state as no live encounter', () => {
    const result = preflightCombatCheckpoint({ checkpoint: checkpoint(null) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan).toBeNull();
    }
  });
});

describe('preflightCombatCheckpoint: corrupt input is refused', () => {
  it('refuses a non-object block', () => {
    const result = preflightCombatCheckpoint({ checkpoint: 'not-a-checkpoint' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalidCheckpoint');
    }
  });

  it('refuses a block with no rules version', () => {
    const result = preflightCombatCheckpoint({
      checkpoint: checkpoint(validState(), { rulesVersion: '' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalidCheckpoint');
    }
  });

  it('refuses a nested state that fails schema validation', () => {
    const result = preflightCombatCheckpoint({
      checkpoint: checkpoint({ schemaVersion: 4, rulesVersion: COMBAT_RULES_VERSION }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalidState');
    }
  });

  it('refuses a state with no encounter or execution-run identity', () => {
    // The schema enforces a non-empty run identity, so the shape check catches
    // this first; `missingEncounterIdentity` is the defensive branch behind it.
    const state = { ...validState(), encounterRunId: '' };
    const result = preflightCombatCheckpoint({ checkpoint: checkpoint(state) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['invalidState', 'missingEncounterIdentity']).toContain(result.reason);
    }
  });

  it('refuses a state whose encounter id is not a string', () => {
    const state = { ...validState(), encounterId: 42 };
    const result = preflightCombatCheckpoint({ checkpoint: checkpoint(state) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalidState');
    }
  });
});

describe('preflightCombatCheckpoint: the rules-version policy is real', () => {
  it('refuses a historical rules version rather than resolving it today', () => {
    const state = createCombatState({
      encounterId: 'emberwatch/preflight',
      rulesVersion: 'combat-0.0.1',
      seed: 7,
      combatants: [],
      abilityCatalog: {},
      battlefield: { width: 4, height: 4, blockedCells: [] },
    });
    const result = preflightCombatCheckpoint({
      checkpoint: checkpoint(state, { rulesVersion: 'combat-0.0.1' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupportedRulesVersion');
      expect(result.detail).toContain('combat-0.0.1');
    }
  });

  it('accepts the current rules version', () => {
    const result = preflightCombatCheckpoint({ checkpoint: checkpoint(validState()) });
    expect(result.ok).toBe(true);
    if (result.ok && result.plan !== null) {
      expect(result.plan.state.rulesVersion).toBe(COMBAT_RULES_VERSION);
      expect(result.plan.migratedFrom).toBeNull();
    }
  });
});

describe('preflightCombatCheckpoint: migration runs in the production load path', () => {
  it('migrates a v3 snapshot and reports the source version', () => {
    const current = validState();
    // A v3 snapshot: no participation / objectiveRules / moraleRules / reaction
    // / settlement, and a v3 schemaVersion.
    const v3 = {
      ...current,
      schemaVersion: 3,
      stateRevision: 2,
    } as Record<string, unknown>;
    for (const key of [
      'participation',
      'objectiveRules',
      'moraleRules',
      'reactionRegistry',
      'reaction',
      'settlement',
    ]) {
      delete v3[key];
    }

    const result = preflightCombatCheckpoint({
      checkpoint: checkpoint(v3, { schemaVersion: 3 }),
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.plan !== null) {
      expect(result.plan.migratedFrom).toBe(3);
      expect(result.plan.state.schemaVersion).toBe(current.schemaVersion);
      // Migration invents no participation history.
      expect(result.plan.state.participation.player?.status).toBe('active');
      expect(result.plan.state.settlement).toBeNull();
    }
  });

  it('reports no migration for a current-version snapshot', () => {
    const result = preflightCombatCheckpoint({ checkpoint: checkpoint(validState()) });
    expect(result.ok).toBe(true);
    if (result.ok && result.plan !== null) {
      expect(result.plan.migratedFrom).toBeNull();
    }
  });
});

describe('preflightCombatCheckpoint: the plan preserves the durable fields', () => {
  it('carries the journal, retry checkpoint and boundary through', () => {
    const result = preflightCombatCheckpoint({
      checkpoint: checkpoint(validState(), {
        sessionRevision: 42,
        journal: { droppedCount: 0, entries: [] },
        initialCheckpoint: {
          encounterId: 'emberwatch/preflight',
          seed: 7,
          engine: 'v2',
          participants: [],
          abilityIdsByCombatant: {},
        },
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.plan !== null) {
      expect(result.plan.checkpoint.sessionRevision).toBe(42);
      expect(result.plan.checkpoint.journal).toEqual({ droppedCount: 0, entries: [] });
      expect(result.plan.checkpoint.initialCheckpoint?.seed).toBe(7);
      // The plan's state is the migrated authority, not the raw envelope value.
      expect(result.plan.state.encounterId).toBe('emberwatch/preflight');
    }
  });
});
