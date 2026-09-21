// packages/shared/utils/src/lib/rules/__tests__/combat_environment.test.ts
//
// Combat-07 acceptance tests: authored objects, registered affordances,
// deterministic checks/effects, derived geometry, hazard cadence, migration and
// replay.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-7

import { describe, expect, it } from 'bun:test';
import {
  ActionForecastSchema,
  COMBAT_ENVIRONMENT_BOUNDS,
  COMBAT_SCHEMA_VERSION,
  CombatStateSchema,
  migrateCombatStateToCurrentVersion,
} from '@aikami/schemas';
import type {
  AffordanceDefinition,
  BattlefieldObject,
  BattlefieldObjectDefinition,
  CombatCommand,
  CombatEnvironmentBundle,
  CombatEvent,
  CombatInteractWithObjectCommand,
  CombatState,
  EnvironmentalState,
  ImpactZoneDefinition,
  ObjectiveRules,
  SurfaceCell,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { createSeedableRng, deserializeRng, serializeRng } from '../../rng/seedable_rng';
import {
  applyEnvironmentalRoundStart,
  COMBAT_ENVIRONMENT_RULES_VERSION,
  coverArmorClassBonus,
  coverAt,
  forcedMovementPath,
  getEnvironmentalGeometry,
  getObjectAffordances,
  impactZoneCells,
  isEnvironmentallyBlocked,
  moveObjectAlong,
  resolveCheckModifier,
  successOdds,
  validateEnvironmentalCommand,
} from '../combat_environment';
import { compileActionIntent } from '../combat_intent_compiler';
import { COMBAT_RULES_VERSION, createCombatState, resolveCombatCommand } from '../combat_kernel';
import { replayCombat } from '../combat_replay';
import { forecastCombatAction, getLegalActions } from '../combat_tactical';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENCOUNTER_ID = 'emberwatch-env-1';
const PLAYER_ID = 'player-hero';
const GOBLIN_ID = 'emberwatch:goblin-1';

const BRAZIER = 'emberwatch/brazier-1';
const SUPPORT = 'emberwatch/support-1';
const CRATE = 'emberwatch/crate-1';
const STACK = 'emberwatch/crate-stack-1';

const BATTLEFIELD = { width: 10, height: 10, blockedCells: [] as Array<{ x: number; y: number }> };

const objectDefinition = (
  overrides: Partial<BattlefieldObjectDefinition> & { definitionId: string },
): BattlefieldObjectDefinition => ({
  name: overrides.definitionId,
  durability: 4,
  blocksMovement: false,
  blocksSight: false,
  cover: 'none',
  affordanceIds: [],
  ...overrides,
});

const affordance = (
  overrides: Partial<AffordanceDefinition> & { affordanceId: string },
): AffordanceDefinition => ({
  name: overrides.affordanceId,
  actionCost: 'action',
  requirements: [],
  check: null,
  successEffects: [],
  failureEffects: [],
  ...overrides,
});

const battleObject = (
  overrides: Partial<BattlefieldObject> & { objectId: string; definitionId: string },
): BattlefieldObject => ({
  position: { x: 0, y: 0 },
  footprint: [{ x: 0, y: 0 }],
  durability: 4,
  state: 'intact',
  ignited: false,
  cover: 'none',
  affordanceIds: [],
  attachedToObjectId: null,
  ...overrides,
});

/** The authored brazier / oil / support / payload recipes of the proof encounter. */
const BUNDLE: CombatEnvironmentBundle = {
  bundleVersion: 1,
  rulesVersion: COMBAT_ENVIRONMENT_RULES_VERSION,
  objectDefinitions: {
    [objectDefinition({ definitionId: 'emberwatch/brazier' }).definitionId]: objectDefinition({
      definitionId: 'emberwatch/brazier',
      affordanceIds: ['tip_over', 'ignite_oil', 'sweep'],
    }),
    [objectDefinition({ definitionId: 'emberwatch/support' }).definitionId]: objectDefinition({
      definitionId: 'emberwatch/support',
      durability: 3,
      blocksMovement: true,
      cover: 'half',
      affordanceIds: ['cut_support'],
    }),
    [objectDefinition({ definitionId: 'emberwatch/crate' }).definitionId]: objectDefinition({
      definitionId: 'emberwatch/crate',
      durability: 5,
    }),
    [objectDefinition({ definitionId: 'emberwatch/crate_stack' }).definitionId]: objectDefinition({
      definitionId: 'emberwatch/crate_stack',
      affordanceIds: ['topple'],
    }),
  },
  affordances: {
    // biome-ignore lint/style/useNamingConvention: authored affordance ids are snake_case
    tip_over: affordance({
      affordanceId: 'tip_over',
      name: 'Tip over',
      requirements: [
        { kind: 'adjacent', value: true },
        { kind: 'objectState', value: 'intact' },
      ],
      check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
      successEffects: [
        { kind: 'setIgnited', objectSelector: 'source', ignited: true },
        {
          kind: 'createSurface',
          surfaceKind: 'fire',
          cellSelector: 'sourceFootprint',
          expiresAfterRound: null,
        },
        { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
      ],
    }),
    sweep: affordance({
      affordanceId: 'sweep',
      name: 'Sweep',
      successEffects: [{ kind: 'setObjectState', objectSelector: 'allObjects', state: 'broken' }],
    }),
    // biome-ignore lint/style/useNamingConvention: authored affordance ids are snake_case
    cut_support: affordance({
      affordanceId: 'cut_support',
      name: 'Cut the support',
      requirements: [
        { kind: 'adjacent', value: true },
        { kind: 'objectState', value: 'intact' },
      ],
      check: { category: 'athletics', dc: 13, modifierSource: 'athletics' },
      successEffects: [
        { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
        { kind: 'dropPayload', objectSelector: 'source', impactZone: 'emberwatch/crate_zone' },
      ],
    }),
    // biome-ignore lint/style/useNamingConvention: authored affordance ids are snake_case
    ignite_oil: affordance({
      affordanceId: 'ignite_oil',
      name: 'Ignite oil',
      actionCost: 'quick',
      requirements: [{ kind: 'adjacent', value: true }],
      successEffects: [
        {
          kind: 'createSurface',
          surfaceKind: 'fire',
          cellSelector: 'sourceFootprint',
          expiresAfterRound: 3,
        },
      ],
    }),
    topple: affordance({
      affordanceId: 'topple',
      name: 'Topple',
      // Composed from the SAME registered effects as the two proof recipes — no
      // object-specific engine code.
      successEffects: [
        { kind: 'moveObject', objectSelector: 'source', steps: 2 },
        { kind: 'setCover', objectSelector: 'source', cover: 'none' },
      ],
    }),
    shove: affordance({
      affordanceId: 'shove',
      name: 'Shove away',
      actionCost: 'quick',
      requirements: [{ kind: 'adjacent', value: true }],
      successEffects: [{ kind: 'forcedMovement', targetSelector: 'actor', cells: 3 }],
    }),
  },
  impactZones: {
    'emberwatch/crate_zone': {
      zoneId: 'emberwatch/crate_zone',
      offsets: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
      diceExpression: '2d6',
      damageType: 'bludgeoning',
    } satisfies ImpactZoneDefinition,
  },
};

const environment = (overrides: Partial<EnvironmentalState> = {}): EnvironmentalState => ({
  objects: {
    [BRAZIER]: battleObject({
      objectId: BRAZIER,
      definitionId: 'emberwatch/brazier',
      position: { x: 1, y: 2 },
      durability: 4,
      affordanceIds: ['tip_over'],
    }),
    [SUPPORT]: battleObject({
      objectId: SUPPORT,
      definitionId: 'emberwatch/support',
      position: { x: 3, y: 2 },
      durability: 3,
      cover: 'half',
      affordanceIds: ['cut_support'],
    }),
    [CRATE]: battleObject({
      objectId: CRATE,
      definitionId: 'emberwatch/crate',
      position: { x: 3, y: 1 },
      durability: 5,
      attachedToObjectId: SUPPORT,
    }),
    [STACK]: battleObject({
      objectId: STACK,
      definitionId: 'emberwatch/crate_stack',
      position: { x: 1, y: 6 },
      durability: 4,
      affordanceIds: ['topple'],
    }),
  },
  surfaces: [],
  hazardTickStamps: [],
  ...overrides,
});

const combatant = (options: {
  combatantId: string;
  team: 'player' | 'enemy';
  position: { x: number; y: number };
  hp?: number;
  checkModifiers?: Record<string, number>;
  initiative?: number;
  abilityIds?: string[];
}) => ({
  combatantId: options.combatantId,
  name: options.combatantId,
  team: options.team,
  position: options.position,
  hp: options.hp ?? 20,
  maxHp: 20,
  armorClass: 12,
  attackBonus: 3,
  initiative: options.initiative ?? (options.team === 'player' ? 10 : 5),
  abilityIds: options.abilityIds ?? [],
  budget: {
    movementRemaining: 6,
    actionAvailable: true,
    quickActionAvailable: true,
    reactionAvailable: true,
  },
  downed: false,
  defeated: false,
  ...(options.checkModifiers === undefined ? {} : { checkModifiers: options.checkModifiers }),
});

const state = (options: { environment?: EnvironmentalState } = {}): CombatState =>
  createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 4242,
    combatants: [
      combatant({
        combatantId: PLAYER_ID,
        team: 'player',
        position: { x: 2, y: 2 },
        checkModifiers: { athletics: 3 },
      }),
      combatant({ combatantId: GOBLIN_ID, team: 'enemy', position: { x: 8, y: 8 } }),
    ],
    abilityCatalog: {},
    battlefield: BATTLEFIELD,
    environment: options.environment ?? environment(),
    environmentBundle: BUNDLE,
  });

const interact = (
  overrides: Partial<CombatInteractWithObjectCommand> = {},
): CombatInteractWithObjectCommand => ({
  kind: 'interactWithObject',
  combatantId: PLAYER_ID,
  objectId: BRAZIER,
  affordanceId: 'tip_over',
  targetObjectId: null,
  ...overrides,
});

/** Runs one command with a fixed seed and returns the raw result. */
const run = (options: {
  state: CombatState;
  command: CombatInteractWithObjectCommand;
  seed?: number;
}) =>
  resolveCombatCommand({
    state: options.state,
    command: options.command,
    basedOnRevision: options.state.stateRevision,
  });

const kinds = (events: CombatEvent[]): string[] => events.map((event) => event.kind);

/** Runs any kernel command against a fixed revision. */
const runCommand = (options: { state: CombatState; command: CombatCommand }) =>
  resolveCombatCommand({
    state: options.state,
    command: options.command,
    basedOnRevision: options.state.stateRevision,
  });

// ---------------------------------------------------------------------------
// AC-1 — authored objects are authoritative
// ---------------------------------------------------------------------------

describe('AC-1 authored objects are authoritative and persist', () => {
  it('round-trips object identity, position, durability, affordances and cover', () => {
    const initial = state();
    const before = initial.environment.objects[SUPPORT];
    expect(before.definitionId).toBe('emberwatch/support');
    expect(before.durability).toBe(3);
    expect(before.cover).toBe('half');
    expect(before.affordanceIds).toEqual(['cut_support']);

    const result = run({
      state: initial,
      command: interact({ objectId: SUPPORT, affordanceId: 'cut_support' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    // Same object, same id — broken, not duplicated and not removed.
    expect(Object.keys(result.state.environment.objects).sort()).toEqual(
      Object.keys(initial.environment.objects).sort(),
    );
    const after = result.state.environment.objects[SUPPORT];
    expect(after.objectId).toBe(SUPPORT);
    expect(after.state).toBe('broken');
    expect(after.durability).toBe(0);
    // Destroying cover never erases terrain.
    expect(result.state.battlefield).toEqual(initial.battlefield);
  });

  it('carries the environment through a fresh createCombatState projection', () => {
    const initial = state();
    const reprojected = createCombatState({
      encounterId: initial.encounterId,
      rulesVersion: initial.rulesVersion,
      seed: initial.rng.seed,
      combatants: Object.values(initial.combatants),
      abilityCatalog: initial.abilityCatalog,
      battlefield: initial.battlefield,
      environment: initial.environment,
      environmentBundle: initial.environmentBundle,
    });
    expect(reprojected.environment).toEqual(initial.environment);
    expect(reprojected.environmentBundle).toEqual(initial.environmentBundle);
  });

  it('resolves a further authored object through the same registry with no object-specific code', () => {
    // `emberwatch/crate_stack` is authored AFTER the two proof recipes and is
    // composed only from already-registered effects.
    const initial = state();
    const result = run({
      state: initial,
      command: interact({ objectId: STACK, affordanceId: 'topple' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const moved = result.state.environment.objects[STACK];
    // `moveObject` moves the object directly away from the acting combatant,
    // stopping at the last legal cell.
    expect(moved.position).toEqual({ x: 1, y: 8 });
    expect(kinds(result.events)).toContain('objectMoved');
  });
});

// ---------------------------------------------------------------------------
// AC-2 — deterministic checks and effects
// ---------------------------------------------------------------------------

describe('AC-2 checks and effects resolve deterministically', () => {
  it('rejects an unknown object without mutating state or RNG', () => {
    const initial = state();
    const before = structuredClone(initial);
    const result = run({ state: initial, command: interact({ objectId: 'nope' }) });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.reasonCode).toBe('objectUnknown');
    expect(initial).toEqual(before);
  });

  it('rejects an unknown affordance without mutating state or RNG', () => {
    const initial = state();
    const before = structuredClone(initial);
    const result = run({ state: initial, command: interact({ affordanceId: 'nope' }) });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.reasonCode).toBe('affordanceUnknown');
    expect(initial).toEqual(before);
  });

  it('rejects a check whose modifier source is not projected instead of substituting attackBonus', () => {
    const initial = createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 7,
      combatants: [
        combatant({ combatantId: PLAYER_ID, team: 'player', position: { x: 2, y: 2 } }),
        combatant({ combatantId: GOBLIN_ID, team: 'enemy', position: { x: 8, y: 8 } }),
      ],
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      environment: environment(),
      environmentBundle: BUNDLE,
    });
    const result = run({ state: initial, command: interact() });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.reasonCode).toBe('checkModifierUnavailable');
    expect(initial.combatants[PLAYER_ID].budget.actionAvailable).toBe(true);
  });

  it('spends the declared cost on a legal failed check but applies no success effect', () => {
    const initial = state();
    // Seed chosen so the d20 + 3 lands below DC 12.
    const actionsBefore = deserializeRng(initial.rng.streams.actions);
    const natural = actionsBefore.dice(20);
    const fails = natural + 3 < 12;
    const result = run({ state: initial, command: interact() });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.combatants[PLAYER_ID].budget.actionAvailable).toBe(false);
    if (fails) {
      expect(result.state.environment.objects[BRAZIER].state).toBe('intact');
      expect(result.state.environment.surfaces).toEqual([]);
    } else {
      expect(result.state.environment.objects[BRAZIER].state).toBe('broken');
    }
  });

  it('applies success effects in declared order with stable event identities', () => {
    // A checkless affordance keeps the assertion independent of the die face.
    const initial = state({
      environment: {
        objects: {
          [BRAZIER]: battleObject({
            objectId: BRAZIER,
            definitionId: 'emberwatch/brazier',
            position: { x: 1, y: 2 },
            affordanceIds: ['ignite_oil'],
          }),
        },
        surfaces: [],
        hazardTickStamps: [],
      },
    });
    const result = run({
      state: initial,
      command: interact({ affordanceId: 'ignite_oil' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(kinds(result.events)).toEqual(['surfaceCreated']);
    const surface = result.state.environment.surfaces[0];
    expect(surface.kind).toBe('fire');
    expect(surface.cell).toEqual({ x: 1, y: 2 });
    expect(surface.expiresAfterRound).toBe(3);
    // Fire consumes oil on the same cell — a registered interaction rule.
  });

  it('replaces an oil surface with fire when fire is created on the same cell', () => {
    const oil: SurfaceCell = {
      surfaceId: 'surface:oil:1:2:none',
      kind: 'oil',
      cell: { x: 1, y: 2 },
      expiresAfterRound: null,
      sourceObjectId: null,
    };
    const initial = state({
      environment: {
        objects: {
          [BRAZIER]: battleObject({
            objectId: BRAZIER,
            definitionId: 'emberwatch/brazier',
            position: { x: 1, y: 2 },
            affordanceIds: ['ignite_oil'],
          }),
        },
        surfaces: [oil],
        hazardTickStamps: [],
      },
    });
    const result = run({ state: initial, command: interact({ affordanceId: 'ignite_oil' }) });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.environment.surfaces.map((surface) => surface.kind)).toEqual(['fire']);
    expect(kinds(result.events)).toContain('surfaceRemoved');
  });

  it('cannot reroll the same command against a stale revision', () => {
    const initial = state();
    const first = run({ state: initial, command: interact() });
    expect(first.valid).toBe(true);
    if (!first.valid) {
      return;
    }
    const second = resolveCombatCommand({
      state: first.state,
      command: interact(),
      basedOnRevision: initial.stateRevision,
    });
    expect(second.valid).toBe(false);
    if (second.valid) {
      return;
    }
    expect(second.reasonCode).toBe('staleRevision');
  });

  it('rejects a cascade beyond the registered bound without retaining mutation', () => {
    const initial = state();
    // Two all-object effects over 64 authored objects exceed the 64-effect
    // expansion cap while keeping the state itself within its object bound.
    // The whole command is rejected and the caller's state is untouched.
    const sweepBundle: CombatEnvironmentBundle = {
      ...BUNDLE,
      affordances: {
        ...BUNDLE.affordances,
        sweep: {
          ...BUNDLE.affordances.sweep,
          successEffects: [
            ...BUNDLE.affordances.sweep.successEffects,
            { kind: 'setIgnited', objectSelector: 'allObjects', ignited: true },
          ],
        },
      },
    };
    const objects: Record<string, BattlefieldObject> = {};
    for (let index = 0; index < 63; index++) {
      const objectId = `emberwatch/barrel-${String(index).padStart(2, '0')}`;
      objects[objectId] = battleObject({
        objectId,
        definitionId: 'emberwatch/brazier',
        position: { x: index % 10, y: Math.floor(index / 10) + 4 },
        affordanceIds: ['sweep'],
      });
    }
    objects[BRAZIER] = battleObject({
      objectId: BRAZIER,
      definitionId: 'emberwatch/brazier',
      position: { x: 1, y: 2 },
      affordanceIds: ['sweep'],
    });
    const expanded = createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 1,
      combatants: Object.values(initial.combatants),
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      environment: { objects, surfaces: [], hazardTickStamps: [] },
      environmentBundle: sweepBundle,
    });

    const result = run({
      state: expanded,
      command: interact({ affordanceId: 'sweep' }),
    });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.reasonCode).toBe('cascadeLimitExceeded');
    expect(expanded.environment.objects[BRAZIER].state).toBe('intact');
    expect(expanded.stateRevision).toBe(0);
  });

  it('reports the check inputs and result as a fact', () => {
    const initial = state();
    const result = run({ state: initial, command: interact() });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const rolled = result.events.find((event) => event.kind === 'environmentalCheckRolled');
    expect(rolled).toBeDefined();
    if (rolled?.kind !== 'environmentalCheckRolled') {
      return;
    }
    expect(rolled.checkCategory).toBe('athletics');
    expect(rolled.modifierSource).toBe('athletics');
    expect(rolled.modifier).toBe(3);
    expect(rolled.dc).toBe(12);
    expect(rolled.total).toBe(rolled.naturalRoll + 3);
    expect(rolled.success).toBe(rolled.total >= 12);
  });

  it('resolves the check modifier from the projected sheet field only', () => {
    expect(
      resolveCheckModifier({
        actor: combatant({
          combatantId: PLAYER_ID,
          team: 'player',
          position: { x: 0, y: 0 },
          checkModifiers: { athletics: 3 },
        }),
        check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
      }),
    ).toBe(3);
    expect(
      resolveCheckModifier({
        actor: combatant({ combatantId: PLAYER_ID, team: 'player', position: { x: 0, y: 0 } }),
        check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
      }),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-3 — geometry and hazards
// ---------------------------------------------------------------------------

describe('AC-3 environmental geometry and hazards affect later actions', () => {
  it('derives walkability and cover from immutable terrain plus current object state', () => {
    const initial = state();
    const geometry = getEnvironmentalGeometry(initial);
    expect(geometry.blockedCells).toContainEqual({ x: 3, y: 2 });
    expect(coverAt({ geometry, cell: { x: 3, y: 2 } })).toBe('half');
    expect(isEnvironmentallyBlocked({ state: initial, geometry, cell: { x: 3, y: 2 } })).toBe(true);

    const broken = structuredClone(initial);
    broken.environment.objects[SUPPORT].state = 'broken';
    const afterGeometry = getEnvironmentalGeometry(broken);
    expect(afterGeometry.blockedCells).not.toContainEqual({ x: 3, y: 2 });
    expect(coverAt({ geometry: afterGeometry, cell: { x: 3, y: 2 } })).toBe('none');
    // Terrain is never erased by destroying an object.
    expect(afterGeometry.blockedCells).toEqual(initial.battlefield.blockedCells);
  });

  it('stops forced movement at the last legal cell and never overlaps an actor', () => {
    const initial = state();
    const blocked = forcedMovementPath({
      state: initial,
      origin: { x: 1, y: 4 },
      direction: { x: 1, y: 0 },
      cells: 5,
    });
    // The support at (3,2) is a wall in column 3: movement stops before it.
    expect(blocked).toEqual([
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
    ]);

    const clear = forcedMovementPath({
      state: initial,
      origin: { x: 1, y: 6 },
      direction: { x: 1, y: 0 },
      cells: 3,
    });
    expect(clear).toEqual([
      { x: 2, y: 6 },
      { x: 3, y: 6 },
      { x: 4, y: 6 },
    ]);
  });

  it('lets forced movement pass broken objects that no longer block movement', () => {
    const initial = state();
    initial.environment.objects[SUPPORT].state = 'broken';
    expect(
      forcedMovementPath({
        state: initial,
        origin: { x: 2, y: 2 },
        direction: { x: 1, y: 0 },
        cells: 2,
      }),
    ).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
  });

  it('stops object movement at the map edge instead of teleporting through it', () => {
    const initial = state();
    const object = initial.environment.objects[STACK];
    object.position = { x: 9, y: 6 };
    const moved = moveObjectAlong({ state: initial, object, direction: { x: 1, y: 0 }, steps: 4 });
    expect(moved).toBe(0);
    expect(object.position).toEqual({ x: 9, y: 6 });
  });

  it('applies at most one hazard hit per actor per round from the same family', () => {
    const fire: SurfaceCell = {
      surfaceId: 'surface:fire:2:2:emberwatch/brazier-1',
      kind: 'fire',
      cell: { x: 2, y: 2 },
      expiresAfterRound: null,
      sourceObjectId: BRAZIER,
    };
    const initial = state({ environment: { ...environment(), surfaces: [fire] } });
    const rng = createSeedableRng(11);
    const events = applyEnvironmentalRoundStart({
      state: initial,
      envelope: { encounterId: ENCOUNTER_ID, turnId: 'r1:player', stateRevision: 0, round: 1 },
      rng,
    });
    expect(kinds(events).filter((kind) => kind === 'environmentalDamageApplied')).toHaveLength(1);
    expect(kinds(events)).toContain('hazardTickStamped');
    expect(initial.environment.hazardTickStamps).toEqual([
      { hazardFamilyId: 'fire', actorId: PLAYER_ID, round: 1 },
    ]);

    const second = applyEnvironmentalRoundStart({
      state: initial,
      envelope: { encounterId: ENCOUNTER_ID, turnId: 'r1:player', stateRevision: 0, round: 1 },
      rng,
    });
    expect(second).toEqual([]);
  });

  it('expires surfaces whose declared round has arrived', () => {
    const expiring: SurfaceCell = {
      surfaceId: 'surface:fire:2:2:emberwatch/brazier-1',
      kind: 'fire',
      cell: { x: 2, y: 2 },
      expiresAfterRound: 2,
      sourceObjectId: BRAZIER,
    };
    const initial = state({ environment: { ...environment(), surfaces: [expiring] } });
    initial.round = 2;
    const events = applyEnvironmentalRoundStart({
      state: initial,
      envelope: { encounterId: ENCOUNTER_ID, turnId: 'r2:player', stateRevision: 0, round: 2 },
      rng: createSeedableRng(3),
    });
    expect(kinds(events)).toContain('surfaceRemoved');
    expect(initial.environment.surfaces).toEqual([]);
    // An expired surface cannot also burn the actor standing on it.
    expect(kinds(events)).not.toContain('environmentalDamageApplied');
  });

  it('drops an attached payload into its authored impact zone and damages occupants', () => {
    const initial = state();
    const result = run({
      state: initial,
      command: interact({ objectId: SUPPORT, affordanceId: 'cut_support' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const payload = result.events.find((event) => event.kind === 'payloadDropped');
    expect(payload).toBeDefined();
    if (payload?.kind !== 'payloadDropped') {
      return;
    }
    expect(payload.payloadObjectId).toBe(CRATE);
    expect(payload.impactZone).toBe('emberwatch/crate_zone');
    expect(payload.cells).toEqual([
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(result.state.environment.objects[CRATE].attachedToObjectId).toBeNull();
    expect(result.state.environment.objects[SUPPORT].state).toBe('broken');
  });

  it('leaves an attached payload unmoved when every landing cell is illegal', () => {
    const initial = state();
    initial.environmentBundle.affordances.cut_support.check = null;
    initial.combatants[GOBLIN_ID].position = { x: 3, y: 3 };
    const before = structuredClone(initial.environment.objects[CRATE]);
    const result = run({
      state: initial,
      command: interact({ objectId: SUPPORT, affordanceId: 'cut_support' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.environment.objects[CRATE]).toEqual(before);
    expect(kinds(result.events)).not.toContain('payloadDropped');
  });
});

// ---------------------------------------------------------------------------
// AC-7 — replay and migration
// ---------------------------------------------------------------------------

describe('AC-7 saves and replay preserve environmental consequences', () => {
  it('replays an environmental command to the identical state and events', () => {
    const initial = state();
    const first = run({ state: initial, command: interact() });
    expect(first.valid).toBe(true);
    if (!first.valid) {
      return;
    }
    const replayed = replayCombat({
      initialState: initial,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: [interact()],
    });
    expect(replayed.finalState).toEqual(first.state);
    expect(replayed.replay.events).toEqual(first.events);
  });

  it('migrates a v2 snapshot to empty environmental state only', () => {
    const current = state();
    const migrated = migrateCombatStateToCurrentVersion({
      ...structuredClone(current),
      schemaVersion: 2,
    });
    expect(Value.Check(CombatStateSchema, migrated)).toBe(true);
    if (!Value.Check(CombatStateSchema, migrated)) {
      return;
    }
    expect(migrated.schemaVersion).toBe(COMBAT_SCHEMA_VERSION);
    expect(migrated.environment).toEqual({ objects: {}, surfaces: [], hazardTickStamps: [] });
    expect(migrated.environmentBundle).toEqual({
      bundleVersion: 1,
      rulesVersion: 'combat-environment-1.0.0',
      objectDefinitions: {},
      affordances: {},
      impactZones: {},
    });
    // Migration never infers destroyed/intact state from scenery.
    expect(migrated.environment.objects).toEqual({});
  });

  it('leaves a current-version snapshot untouched', () => {
    const current = state();
    expect(migrateCombatStateToCurrentVersion(current)).toBe(current);
  });
});

// ---------------------------------------------------------------------------
// Inspector + bounds
// ---------------------------------------------------------------------------

describe('object inspector and bounds', () => {
  it('reports every affordance with the reason an unavailable one is unavailable', () => {
    const initial = state();
    const views = getObjectAffordances({ state: initial, actorId: PLAYER_ID });
    const tip = views.find((view) => view.affordanceId === 'tip_over');
    expect(tip?.available).toBe(true);
    expect(tip?.unavailableReasonCode).toBeNull();

    const far = createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 2,
      combatants: [
        combatant({
          combatantId: PLAYER_ID,
          team: 'player',
          position: { x: 8, y: 8 },
          checkModifiers: { athletics: 3 },
        }),
      ],
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      environment: environment(),
      environmentBundle: BUNDLE,
    });
    const farViews = getObjectAffordances({ state: far, actorId: PLAYER_ID });
    const farTip = farViews.find((view) => view.affordanceId === 'tip_over');
    expect(farTip?.available).toBe(false);
    expect(farTip?.unavailableReasonCode).toBe('requirementUnmet');
    expect(farTip?.unavailableMessageKey).toBe('combat.invalid.requirement_unmet');
  });

  it('validates an environmental command without mutating state or advancing the RNG', () => {
    const initial = state();
    const before = structuredClone(initial);
    const eligibility = validateEnvironmentalCommand({
      state: initial,
      actorId: PLAYER_ID,
      command: interact(),
    });
    expect(eligibility.valid).toBe(true);
    expect(initial).toEqual(before);
  });

  it('bounds the effect expansion constant at 64', () => {
    expect(COMBAT_ENVIRONMENT_BOUNDS.effectExpansion).toBe(64);
  });

  it('filters impact-zone offsets to battlefield bounds before forecasting', () => {
    expect(
      impactZoneCells({
        zone: {
          zoneId: 'edge-zone',
          offsets: [
            { x: -1, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          diceExpression: '1d4',
          damageType: 'fire',
        },
        origin: { x: 0, y: 0 },
        battlefield: BATTLEFIELD,
      }),
    ).toEqual([{ x: 0, y: 0 }]);
  });

  it('serializes the RNG only on a committed environmental command', () => {
    const initial = state();
    const before = serializeRng(deserializeRng(initial.rng.streams.actions));
    const rejected = run({ state: initial, command: interact({ objectId: 'missing' }) });
    expect(rejected.valid).toBe(false);
    expect(serializeRng(deserializeRng(initial.rng.streams.actions))).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// AC-3 / AC-4 — tactical integration
// ---------------------------------------------------------------------------

describe('environmental geometry feeds the tactical layer', () => {
  it('excludes cells blocked by an intact object from legal movement, and opens them when it breaks', () => {
    const initial = state();
    const endpoints = getLegalActions({ state: initial, combatantId: PLAYER_ID }).endpoints;
    expect(endpoints.some((cell) => cell.x === 3 && cell.y === 2)).toBe(false);
    // (3,2) is reachable by going around the support.
    expect(endpoints.some((cell) => cell.x === 4 && cell.y === 2)).toBe(true);

    const broken = structuredClone(initial);
    broken.environment.objects[SUPPORT].state = 'broken';
    const afterEndpoints = getLegalActions({ state: broken, combatantId: PLAYER_ID }).endpoints;
    expect(afterEndpoints.some((cell) => cell.x === 3 && cell.y === 2)).toBe(true);
  });

  it('forecasts an environmental command without advancing the RNG', () => {
    const initial = state();
    const before = structuredClone(initial);
    const result = forecastCombatAction({ state: initial, command: interact() });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.actionCost).toBe('action');
    expect(result.forecast.checkOutcome).toEqual({
      category: 'athletics',
      dc: 12,
      modifierSource: 'athletics',
      modifier: 3,
      modifierAvailable: true,
      successOdds: successOdds({ modifier: 3, dc: 12 }),
    });
    expect(result.forecast.environmentalEffects?.map((effect) => effect.change)).toEqual([
      'objectIgnited',
      'surfaceCreated',
      'objectState',
    ]);
    expect(result.forecast.impactCells).toEqual([{ x: 1, y: 2 }]);
    expect(result.forecast.warnings).toContain('createsHazard');
    expect(result.forecast.warnings).toContain('destroysCover');
    // Preview is a pure question.
    expect(initial).toEqual(before);
  });

  it('forecasts authored damage targets and warns when the acting combatant is affected', () => {
    const initial = state();
    initial.environmentBundle.affordances.self_damage = affordance({
      affordanceId: 'self_damage',
      successEffects: [
        {
          kind: 'damage',
          targetSelector: 'actor',
          diceExpression: '1d4',
          damageType: 'fire',
        },
      ],
    });
    initial.environmentBundle.objectDefinitions['emberwatch/brazier'].affordanceIds.push(
      'self_damage',
    );
    initial.environment.objects[BRAZIER].affordanceIds = ['self_damage'];

    const result = forecastCombatAction({
      state: initial,
      command: interact({ affordanceId: 'self_damage' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.affectedEntityIds).toEqual([PLAYER_ID]);
    expect(result.forecast.warnings).toContain('damagesSelf');
    expect(result.forecast.environmentalEffects?.map((effect) => effect.change)).toEqual([
      'damage',
    ]);
  });

  it('caps all-object forecast expansion at the action forecast schema limit', () => {
    const initial = state();
    const objects: Record<string, BattlefieldObject> = {};
    for (let index = 0; index < 40; index++) {
      const objectId = `emberwatch/brazier-${index}`;
      objects[objectId] = battleObject({
        objectId,
        definitionId: 'emberwatch/brazier',
        position: index === 0 ? { x: 1, y: 2 } : { x: 5, y: 5 },
        affordanceIds: ['sweep'],
      });
    }
    initial.environment.objects = objects;
    initial.environmentBundle.affordances.sweep.successEffects = [
      { kind: 'setObjectState', objectSelector: 'allObjects', state: 'broken' },
      { kind: 'setCover', objectSelector: 'allObjects', cover: 'none' },
    ];

    const result = forecastCombatAction({
      state: initial,
      command: interact({ objectId: 'emberwatch/brazier-0', affordanceId: 'sweep' }),
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.forecast.environmentalEffects).toHaveLength(
      COMBAT_ENVIRONMENT_BOUNDS.effectExpansion,
    );
    expect(Value.Check(ActionForecastSchema, result.forecast)).toBe(true);
  });

  it('states that the check cannot be rolled when the modifier source is missing', () => {
    const initial = createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 5,
      combatants: [combatant({ combatantId: PLAYER_ID, team: 'player', position: { x: 2, y: 2 } })],
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      environment: environment(),
      environmentBundle: BUNDLE,
    });
    const result = forecastCombatAction({ state: initial, command: interact() });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.reasonCode).toBe('checkModifierUnavailable');
  });
});

// ---------------------------------------------------------------------------
// AC-3 — cover is an armor-class modifier
// ---------------------------------------------------------------------------

describe('cover as an armor-class modifier (AC-3)', () => {
  const rangedState = (): CombatState =>
    createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 31,
      combatants: [
        combatant({
          combatantId: PLAYER_ID,
          team: 'player',
          // Two cells away: non-adjacent, so the target's cover applies.
          position: { x: 1, y: 2 },
          abilityIds: ['bow_shot'],
        }),
        // The goblin stands in the support's cell: half cover, +2 AC.
        combatant({ combatantId: GOBLIN_ID, team: 'enemy', position: { x: 3, y: 2 } }),
      ],
      abilityCatalog: {
        // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
        bow_shot: {
          abilityId: 'bow_shot',
          name: 'Bow Shot',
          kind: 'ranged_attack',
          actionCost: 'action',
          attackBonus: 0,
          damageDice: '1d6',
          damageType: 'piercing',
          rangeCells: 6,
          requiresLineOfSight: false,
        },
      },
      battlefield: BATTLEFIELD,
      environment: environment(),
      environmentBundle: BUNDLE,
    });

  it('grants the cover bonus against a non-adjacent attacker', () => {
    const initial = rangedState();
    expect(
      coverArmorClassBonus({
        state: initial,
        attacker: { x: 2, y: 2 },
        target: { x: 3, y: 2 },
      }),
    ).toBe(0); // adjacent — the attacker is past the obstruction
    expect(
      coverArmorClassBonus({
        state: initial,
        attacker: { x: 0, y: 2 },
        target: { x: 3, y: 2 },
      }),
    ).toBe(2);
  });

  it('stops granting cover the moment the object is destroyed', () => {
    const broken = rangedState();
    broken.environment.objects[SUPPORT].state = 'broken';
    expect(
      coverArmorClassBonus({
        state: broken,
        attacker: { x: 0, y: 2 },
        target: { x: 3, y: 2 },
      }),
    ).toBe(0);
  });

  it('resolves the attack against the cover-modified armor class', () => {
    const initial = rangedState();
    const withCover = runCommand({
      state: initial,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'bow_shot',
        targetIds: [GOBLIN_ID],
      },
    });
    expect(withCover.valid).toBe(true);
    if (!withCover.valid) {
      return;
    }
    const rolled = withCover.events.find((event) => event.kind === 'attackRolled');
    expect(rolled?.kind).toBe('attackRolled');
    if (rolled?.kind !== 'attackRolled') {
      return;
    }
    // armorClass 12 + cover 2 = 14, from a non-adjacent attacker.
    expect(rolled.hit).toBe(rolled.totalRoll >= 14);

    // Destroying the support removes the bonus from the very next attack.
    const broken = rangedState();
    broken.environment.objects[SUPPORT].state = 'broken';
    const withoutCover = runCommand({
      state: broken,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'bow_shot',
        targetIds: [GOBLIN_ID],
      },
    });
    expect(withoutCover.valid).toBe(true);
    if (!withoutCover.valid) {
      return;
    }
    const rolledAgain = withoutCover.events.find((event) => event.kind === 'attackRolled');
    expect(rolledAgain).toBeDefined();
    if (rolledAgain?.kind !== 'attackRolled') {
      return;
    }
    expect(rolledAgain.hit).toBe(rolledAgain.totalRoll >= 12);
  });

  it('forecasts the same effective armor class the kernel resolves against', () => {
    const initial = rangedState();
    const forecast = forecastCombatAction({
      state: initial,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'bow_shot',
        targetIds: [GOBLIN_ID],
      },
    });
    expect(forecast.valid).toBe(true);
    if (!forecast.valid) {
      return;
    }
    const committed = runCommand({
      state: initial,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'bow_shot',
        targetIds: [GOBLIN_ID],
      },
    });
    expect(committed.valid).toBe(true);
    if (!committed.valid) {
      return;
    }
    const rolled = committed.events.find((event) => event.kind === 'attackRolled');
    expect(rolled).toBeDefined();
    if (rolled?.kind !== 'attackRolled') {
      return;
    }
    // Same inputs ⇒ the same effective armor class the kernel resolved against:
    // the forecast's hit chance and the committed roll agree on AC 12 + 2.
    expect(forecast.forecast.hitChance).toBeCloseTo(0.5, 10);
    expect(rolled.hit).toBe(rolled.totalRoll >= 14);
  });
});

// ---------------------------------------------------------------------------
// AC-4 / AC-5 — the language and AI proposal path grounds an environmental step
// ---------------------------------------------------------------------------

describe('interact_with_object intent grounding (AC-4, AC-5)', () => {
  it('grounds a named object and affordance onto the same command the inspector sends', () => {
    const initial = state();
    const result = compileActionIntent({
      state: initial,
      intent: {
        intentId: 'intent-1',
        encounterId: ENCOUNTER_ID,
        actorId: PLAYER_ID,
        basedOnRevision: initial.stateRevision,
        source: 'ai_decision',
        steps: [
          {
            kind: 'interact_with_object',
            object: 'brazier',
            affordance: 'tip over',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      return;
    }
    // The SAME command the manual object inspector sends — one mechanical path.
    expect(result.plan.command).toEqual({
      kind: 'interactWithObject',
      combatantId: PLAYER_ID,
      objectId: BRAZIER,
      affordanceId: 'tip_over',
      targetObjectId: null,
    });
    // And it carries the engine's own forecast, so the AI's preview and the
    // player's preview cannot disagree.
    expect(result.plan.forecast.checkOutcome?.dc).toBe(12);
    expect(result.plan.forecast.environmentalEffects?.map((effect) => effect.change)).toContain(
      'objectState',
    );
  });

  it('enforces the candidate cap across all matching objects', () => {
    const initial = state();
    initial.environment.objects['emberwatch/brazier-2'] = battleObject({
      objectId: 'emberwatch/brazier-2',
      definitionId: 'emberwatch/brazier',
      position: { x: 2, y: 3 },
      affordanceIds: ['tip_over'],
    });
    const result = compileActionIntent({
      state: initial,
      maxCandidates: 1,
      intent: {
        intentId: 'intent-capped',
        encounterId: ENCOUNTER_ID,
        actorId: PLAYER_ID,
        basedOnRevision: initial.stateRevision,
        source: 'ai_decision',
        steps: [{ kind: 'interact_with_object', object: 'brazier', affordance: 'tip over' }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.kind).toBe('plan');
  });

  it('rejects a named object the encounter does not author', () => {
    const initial = state();
    const result = compileActionIntent({
      state: initial,
      intent: {
        intentId: 'intent-2',
        encounterId: ENCOUNTER_ID,
        actorId: PLAYER_ID,
        basedOnRevision: initial.stateRevision,
        source: 'ai_decision',
        steps: [{ kind: 'interact_with_object', object: 'chandelier', affordance: 'cut' }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reasonCode).toBe('objectUnknown');
  });

  it('rejects a named affordance the object does not expose', () => {
    const initial = state();
    const result = compileActionIntent({
      state: initial,
      intent: {
        intentId: 'intent-3',
        encounterId: ENCOUNTER_ID,
        actorId: PLAYER_ID,
        basedOnRevision: initial.stateRevision,
        source: 'ai_decision',
        steps: [{ kind: 'interact_with_object', object: 'brazier', affordance: 'polish' }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reasonCode).toBe('affordanceUnknown');
  });

  it('is a pure question — compiling mutates nothing', () => {
    const initial = state();
    const before = structuredClone(initial);
    compileActionIntent({
      state: initial,
      intent: {
        intentId: 'intent-4',
        encounterId: ENCOUNTER_ID,
        actorId: PLAYER_ID,
        basedOnRevision: initial.stateRevision,
        source: 'ai_decision',
        steps: [{ kind: 'interact_with_object', object: 'brazier', affordance: 'tip over' }],
      },
    });
    expect(initial).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// C-532 AC-1 — an interaction is an objective fact only on a successful check
// ---------------------------------------------------------------------------

describe('AC-1 interaction objective facts require a successful completion', () => {
  const stopRitualRules = (): ObjectiveRules => ({
    definitions: [
      {
        objectiveId: 'objective.stop_ritual',
        kind: 'interact_before_deadline',
        required: true,
        hidden: false,
        rule: {
          kind: 'interact_before_deadline',
          objectId: BRAZIER,
          affordanceId: 'tip_over',
          deadlineRound: 99,
          requiredActorIds: [PLAYER_ID],
        },
      },
    ],
    protectedActorIds: [],
  });

  const stateWithDc = (dc: number): CombatState =>
    createCombatState({
      encounterId: ENCOUNTER_ID,
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 4242,
      combatants: [
        combatant({
          combatantId: PLAYER_ID,
          team: 'player',
          position: { x: 2, y: 2 },
          checkModifiers: { athletics: 3 },
        }),
        combatant({ combatantId: GOBLIN_ID, team: 'enemy', position: { x: 8, y: 8 } }),
      ],
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      environment: environment(),
      environmentBundle: {
        ...BUNDLE,
        affordances: {
          ...BUNDLE.affordances,
          // biome-ignore lint/style/useNamingConvention: authored affordance ids are snake_case
          tip_over: {
            ...BUNDLE.affordances.tip_over,
            check: { category: 'athletics', dc, modifierSource: 'athletics' },
          },
        },
      },
      objectiveRules: stopRitualRules(),
    });

  const statusOf = (result: { state: CombatState }, objectiveId: string) =>
    result.state.objectives.find((objective) => objective.objectiveId === objectiveId)?.status;

  it('does not complete the ritual when the authored check fails', () => {
    const failed = run({ state: stateWithDc(60), command: interact() });
    expect(failed.valid).toBe(true);
    if (!failed.valid) {
      return;
    }
    const rolled = failed.events.find((event) => event.kind === 'environmentalCheckRolled');
    expect(rolled).toMatchObject({ success: false });
    // The attempt was legal and spent its cost, but a failed check is not a
    // completed interaction and must not latch the objective.
    expect(statusOf(failed, 'objective.stop_ritual')).toBe('pending');
  });

  it('completes the ritual when the authored check succeeds', () => {
    const succeeded = run({ state: stateWithDc(1), command: interact() });
    expect(succeeded.valid).toBe(true);
    if (!succeeded.valid) {
      return;
    }
    const rolled = succeeded.events.find((event) => event.kind === 'environmentalCheckRolled');
    expect(rolled).toMatchObject({ success: true });
    expect(statusOf(succeeded, 'objective.stop_ritual')).toBe('complete');
  });
});
