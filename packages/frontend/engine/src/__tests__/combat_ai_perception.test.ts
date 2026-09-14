// packages/frontend/engine/src/__tests__/combat_ai_perception.test.ts
//
// C-526 AC-2 / AC-8: the decision snapshot contains only what the actor may
// perceive, is bounded, and lets character drive choice.
//
//   AC-2  actor identity/role/personality/relationships/fears, objectives,
//         visible combatants, legal capabilities, reachable targets, candidate
//         positions, imminent threats, risk/obedience/difficulty and bounded
//         recent events; hidden enemies/secrets/raw ECS excluded; serialized
//         size fits `tokenBudget`
//   AC-8  personality/risk/obedience/difficulty enter through context fields;
//         every characterful choice is still legal
//
// Contract: C-526 AC-2, AC-8

import { describe, expect, it } from 'bun:test';
import { COMBAT_AI_BOUNDS, COMBAT_AI_TOKEN_BUDGET } from '@aikami/schemas';
import type { CombatEvent, CombatState } from '@aikami/types';
import {
  authoredTelegraphForCommand,
  buildCombatDecisionContext,
  healthBandOf,
  rangeBandForDistance,
} from '../combat/combat_ai_perception.ts';

// ── Fixture ────────────────────────────────────────────────────────────

const rngStream = (seed: number) => ({ seed, state: seed });

const ability = (overrides: Partial<Record<string, unknown>> = {}) => ({
  abilityId: 'basic_melee',
  name: 'Basic Melee',
  kind: 'melee_attack',
  actionCost: 'action',
  attackBonus: 3,
  damageDice: '1d8',
  damageType: 'slashing',
  rangeCells: 1,
  requiresLineOfSight: true,
  ...overrides,
});

type CombatantOverrides = {
  combatantId: string;
  name?: string;
  team?: 'player' | 'ally' | 'enemy' | 'neutral';
  x?: number;
  y?: number;
  hp?: number;
  maxHp?: number;
  abilityIds?: string[];
  downed?: boolean;
  defeated?: boolean;
  movementRemaining?: number;
  actionAvailable?: boolean;
};

const combatant = (overrides: CombatantOverrides) => ({
  combatantId: overrides.combatantId,
  name: overrides.name ?? overrides.combatantId,
  team: overrides.team ?? 'enemy',
  position: { x: overrides.x ?? 2, y: overrides.y ?? 2 },
  hp: overrides.hp ?? 10,
  maxHp: overrides.maxHp ?? 10,
  armorClass: 12,
  attackBonus: 3,
  initiative: 10,
  abilityIds: overrides.abilityIds ?? ['basic_melee'],
  budget: {
    movementRemaining: overrides.movementRemaining ?? 6,
    actionAvailable: overrides.actionAvailable ?? true,
    quickActionAvailable: true,
    reactionAvailable: false,
  },
  downed: overrides.downed ?? false,
  defeated: overrides.defeated ?? false,
});

const buildState = (options: { combatants?: ReturnType<typeof combatant>[] } = {}): CombatState =>
  ({
    schemaVersion: 2,
    rulesVersion: 'combat-2.0.0',
    encounterId: 'c526/perception',
    stateRevision: 4,
    round: 1,
    phase: 'active',
    turnId: 'r1:emberwatch/goblin-1',
    rng: {
      seed: 4242,
      streams: { initiative: rngStream(1), actions: rngStream(2), loot: rngStream(3) },
    },
    initiative: { order: ['emberwatch/goblin-1', 'player'], activeIndex: 0 },
    combatants: Object.fromEntries(
      (
        options.combatants ?? [
          combatant({
            combatantId: 'emberwatch/goblin-1',
            name: 'Goblin Archer',
            x: 2,
            y: 2,
            abilityIds: ['basic_melee', 'shortbow'],
          }),
          combatant({
            combatantId: 'player',
            name: 'Mara',
            team: 'player',
            x: 3,
            y: 2,
            hp: 6,
            maxHp: 20,
          }),
          combatant({ combatantId: 'emberwatch/hidden-1', name: 'Hidden Stalker', x: 7, y: 7 }),
        ]
      ).map((entry) => [entry.combatantId, entry]),
    ),
    abilityCatalog: {
      // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
      basic_melee: ability(),
      shortbow: ability({
        abilityId: 'shortbow',
        name: 'Shortbow',
        kind: 'ranged_attack',
        rangeCells: 6,
        damageDice: '1d6',
      }),
    },
    battlefield: { width: 10, height: 10, blockedCells: [{ x: 0, y: 0 }] },
    objectives: [
      { objectiveId: 'objective-1', kind: 'defeat_all_hostiles', status: 'pending' as const },
    ],
    outcome: null,
  }) as CombatState;

const policy = {
  role: 'skirmisher',
  personality: ['vengeful', 'quick-tempered'],
  relationships: [{ combatantId: 'player', stance: 'hostile' as const, note: 'slew my kin' }],
  fears: ['fire'],
  emotionalState: 'wary',
};

const attackEvent: CombatEvent = {
  kind: 'attackRolled',
  encounterId: 'c526/perception',
  turnId: 'r1:player',
  stateRevision: 4,
  round: 1,
  attackerId: 'player',
  targetId: 'emberwatch/goblin-1',
  abilityId: 'basic_melee',
  naturalRoll: 15,
  totalRoll: 18,
  hit: true,
  isCriticalHit: false,
};

const hiddenEvent: CombatEvent = {
  kind: 'attackRolled',
  encounterId: 'c526/perception',
  turnId: 'r1:hidden',
  stateRevision: 4,
  round: 1,
  attackerId: 'emberwatch/hidden-1',
  targetId: 'player',
  abilityId: 'basic_melee',
  naturalRoll: 15,
  totalRoll: 18,
  hit: true,
  isCriticalHit: false,
};

// ── AC-2 ───────────────────────────────────────────────────────────────

describe('buildCombatDecisionContext (AC-2)', () => {
  it('returns undefined for an unknown, defeated or ended actor', () => {
    const state = buildState();
    expect(buildCombatDecisionContext({ state, combatantId: 'nobody' })).toBeUndefined();
    expect(
      buildCombatDecisionContext({
        state: buildState({
          combatants: [combatant({ combatantId: 'emberwatch/goblin-1', defeated: true })],
        }),
        combatantId: 'emberwatch/goblin-1',
      }),
    ).toBeUndefined();
    expect(
      buildCombatDecisionContext({
        state: { ...state, phase: 'ended' },
        combatantId: 'emberwatch/goblin-1',
      }),
    ).toBeUndefined();
  });

  it('carries the actor identity, role, personality, relationships and fears', () => {
    const context = buildCombatDecisionContext({
      state: buildState(),
      combatantId: 'emberwatch/goblin-1',
      policy,
    });
    expect(context).toBeDefined();
    expect(context?.actor.combatantId).toBe('emberwatch/goblin-1');
    expect(context?.actor.role).toBe('skirmisher');
    expect(context?.actor.personality).toEqual(['vengeful', 'quick-tempered']);
    expect(context?.actor.relationships).toEqual([
      { combatantId: 'player', stance: 'hostile', note: 'slew my kin' },
    ]);
    expect(context?.actor.fears).toEqual(['fire']);
  });

  it('carries kernel objectives without inventing mechanics', () => {
    const context = buildCombatDecisionContext({
      state: buildState(),
      combatantId: 'emberwatch/goblin-1',
    });
    expect(context?.objectives).toEqual([
      { objectiveId: 'objective-1', kind: 'defeat_all_hostiles', status: 'pending' },
    ]);
  });

  it('reports visible combatants with a health band, not raw HP', () => {
    const context = buildCombatDecisionContext({
      state: buildState(),
      combatantId: 'emberwatch/goblin-1',
    });
    const player = context?.visibleCombatants.find((entry) => entry.combatantId === 'player');
    expect(player).toEqual({
      combatantId: 'player',
      team: 'player',
      healthBand: 'bloodied',
      conditions: [],
      lastKnown: { x: 3, y: 2 },
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('"hp"');
    expect(serialized).not.toContain('maxHp');
  });

  it('reports legal capabilities and reachable targets', () => {
    const context = buildCombatDecisionContext({
      state: buildState(),
      combatantId: 'emberwatch/goblin-1',
    });
    const melee = context?.capabilities.find((entry) => entry.abilityId === 'basic_melee');
    expect(melee).toEqual({
      abilityId: 'basic_melee',
      rangeBand: 'melee',
      requiresLineOfSight: true,
      available: true,
    });
    expect(context?.reachableTargets).toContainEqual({
      combatantId: 'player',
      distanceBand: 'melee',
      cover: 'none',
    });
  });

  it('reports candidate positions, threats and bounded neutral policy defaults', () => {
    const context = buildCombatDecisionContext({
      state: buildState(),
      combatantId: 'emberwatch/goblin-1',
    });
    expect(context?.candidatePositions.length).toBeGreaterThan(0);
    expect(context?.imminentThreats).toContainEqual(expect.stringContaining('Mara'));
    expect(context?.morale).toBe('steady');
    expect(context?.riskTolerance).toBe('balanced');
    expect(context?.obedience).toBe('obedient');
    expect(context?.difficulty).toBe('normal');
    expect(context?.tokenBudget).toBe(COMBAT_AI_TOKEN_BUDGET);
  });

  it('excludes hidden enemies, their events and their threats under a vision mask', () => {
    const context = buildCombatDecisionContext({
      state: buildState(),
      combatantId: 'emberwatch/goblin-1',
      visibleCombatantIds: ['player'],
      recentEvents: [attackEvent, hiddenEvent],
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('hidden-1');
    expect(context?.recentEvents).toHaveLength(1);
    expect(context?.recentEvents[0]?.summary).toContain('Mara');
  });

  it('never dumps raw ECS state, the ability catalog or secrets', () => {
    const serialized = JSON.stringify(
      buildCombatDecisionContext({ state: buildState(), combatantId: 'emberwatch/goblin-1' }),
    );
    for (const forbidden of [
      'blockedCells',
      'abilityCatalog',
      'rng',
      'stateRevision',
      'rulesVersion',
      'attackBonus',
      'armorClass',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('bounds every array and fits the token budget on a maximal fixture', () => {
    const manyCombatants = Array.from({ length: 20 }, (_, index) =>
      combatant({
        combatantId: `enemy-${String(index).padStart(2, '0')}`,
        name: `Enemy ${index}`,
        team: 'enemy',
        x: index % 10,
        y: 9,
        abilityIds: ['basic_melee', 'shortbow'],
      }),
    );
    manyCombatants.push(
      combatant({
        combatantId: 'emberwatch/goblin-1',
        name: 'Goblin Archer',
        x: 2,
        y: 2,
        abilityIds: ['basic_melee', 'shortbow'],
      }),
      combatant({ combatantId: 'player', name: 'Mara', team: 'player', x: 3, y: 2 }),
    );
    const state = buildState({ combatants: manyCombatants });
    const events: CombatEvent[] = Array.from({ length: 20 }, () => attackEvent);
    const context = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      recentEvents: events,
      policy: {
        personality: ['a', 'b', 'c', 'd', 'e'],
        relationships: Array.from({ length: 12 }, (_, index) => ({
          combatantId: `enemy-${index}`,
          stance: 'hostile' as const,
        })),
        fears: ['a', 'b', 'c', 'd', 'e'],
      },
    });
    expect(context).toBeDefined();
    expect(context?.visibleCombatants.length).toBeLessThanOrEqual(
      COMBAT_AI_BOUNDS.visibleCombatants,
    );
    expect(context?.capabilities.length).toBeLessThanOrEqual(COMBAT_AI_BOUNDS.capabilities);
    expect(context?.reachableTargets.length).toBeLessThanOrEqual(COMBAT_AI_BOUNDS.reachableTargets);
    expect(context?.candidatePositions.length).toBeLessThanOrEqual(
      COMBAT_AI_BOUNDS.candidatePositions,
    );
    expect(context?.imminentThreats.length).toBeLessThanOrEqual(COMBAT_AI_BOUNDS.imminentThreats);
    expect(context?.recentEvents.length).toBeLessThanOrEqual(COMBAT_AI_BOUNDS.recentEvents);
    expect(context?.actor.personality.length).toBeLessThanOrEqual(
      COMBAT_AI_BOUNDS.personalityTraits,
    );
    expect(context?.actor.relationships.length).toBeLessThanOrEqual(COMBAT_AI_BOUNDS.relationships);
    expect(context?.actor.fears.length).toBeLessThanOrEqual(COMBAT_AI_BOUNDS.fears);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(COMBAT_AI_TOKEN_BUDGET * 4);
  });
});

// ── AC-8 ───────────────────────────────────────────────────────────────

describe('character over optimization (AC-8)', () => {
  it('lets personality, risk tolerance and obedience change the context only', () => {
    const state = buildState();
    const bold = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      policy: { personality: ['reckless'], riskTolerance: 'bold', obedience: 'independent' },
    });
    const cautious = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      policy: { personality: ['timid'], riskTolerance: 'cautious', obedience: 'obedient' },
    });
    expect(bold?.riskTolerance).toBe('bold');
    expect(cautious?.riskTolerance).toBe('cautious');
    expect(bold?.obedience).toBe('independent');
    expect(bold?.actor.personality).not.toEqual(cautious?.actor.personality);
  });

  it('adjusts difficulty through the policy field, not through a different snapshot shape', () => {
    const state = buildState();
    const easy = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      policy: { difficulty: 'easy' },
    });
    const hard = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      policy: { difficulty: 'hard' },
    });
    expect(easy?.difficulty).toBe('easy');
    expect(hard?.difficulty).toBe('hard');
    expect(Object.keys(easy ?? {}).sort()).toEqual(Object.keys(hard ?? {}).sort());
  });

  it('derives the same legal reachable targets regardless of personality', () => {
    const state = buildState();
    const bold = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      policy: { personality: ['reckless'] },
    });
    const timid = buildCombatDecisionContext({
      state,
      combatantId: 'emberwatch/goblin-1',
      policy: { personality: ['timid'] },
    });
    expect(bold?.reachableTargets).toEqual(timid?.reachableTargets);
  });
});

// ── Small helper contracts ─────────────────────────────────────────────

describe('perception helpers', () => {
  it('bands health without exposing a total', () => {
    expect(healthBandOf({ hp: 10, maxHp: 10 })).toBe('healthy');
    expect(healthBandOf({ hp: 5, maxHp: 10 })).toBe('bloodied');
    expect(healthBandOf({ hp: 1, maxHp: 10 })).toBe('critical');
  });

  it('bands distance', () => {
    expect(rangeBandForDistance(1)).toBe('melee');
    expect(rangeBandForDistance(2)).toBe('reach');
    expect(rangeBandForDistance(5)).toBe('ranged');
  });

  it('authors a bounded telegraph for the deterministic fallback (AC-7)', () => {
    const state = buildState();
    expect(
      authoredTelegraphForCommand({
        state,
        command: { kind: 'useAbility', targetIds: ['player'] },
      }),
    ).toBe('preparing an attack on Mara');
    expect(authoredTelegraphForCommand({ state, command: { kind: 'move' } })).toBe(
      'manoeuvring for position',
    );
    expect(authoredTelegraphForCommand({ state, command: { kind: 'defend' } })).toBe(
      'bracing for the next blow',
    );
  });
});
