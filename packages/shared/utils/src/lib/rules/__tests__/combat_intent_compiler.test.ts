// packages/shared/utils/src/lib/rules/__tests__/combat_intent_compiler.test.ts
//
// C-525 (Combat-05) deterministic intent-compiler coverage.
//
//   AC-3  selectors resolve deterministically against live state; the output is
//         a CompiledPlan with a command, forecast, assumptions and warnings; an
//         unsatisfiable selector is a typed rejection, never a fabricated
//         capability; tie-breaks are stable and nothing leaks
//   AC-5  clarification is asked only when readings differ materially
//
// Contract: C-525 AC-3, AC-5

import { describe, expect, it } from 'bun:test';
import type { ActionIntent, CombatInvalidReason, CombatState, IntentStep } from '@aikami/types';
import {
  compileActionIntent,
  decideIntentClarification,
  type IntentPlanCandidate,
  resolveAbilitySelector,
  resolveEntitySelector,
} from '../combat_intent_compiler';
import { createCombatState } from '../combat_kernel';
import {
  ABILITY_CATALOG,
  BATTLEFIELD,
  createInput,
  deepFreeze,
  GOBLIN_1,
  GOBLIN_2,
  makeCombatant,
  PLAYER_ID,
} from './combat_fixtures';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const intentWith = (steps: IntentStep[], overrides: Partial<ActionIntent> = {}): ActionIntent => ({
  intentId: 'intent-1',
  encounterId: 'emberwatch-encounter-1',
  actorId: PLAYER_ID,
  basedOnRevision: 0,
  source: 'player_language',
  steps,
  ...overrides,
});

const useAbility = (
  ability: Extract<IntentStep, { kind: 'use_ability' }>['ability'],
  target: Extract<IntentStep, { kind: 'use_ability' }>['target'],
): IntentStep => ({ kind: 'use_ability', ability, target });

/** Default fixture: hero at (0,0), a goblin adjacent at (1,0), an archer at (3,3). */
const baseState = (): CombatState => createCombatState(createInput());

/** Hero at (0,0), one goblin four cells east — a deterministic standoff fixture. */
const distantState = (): CombatState =>
  createCombatState(
    createInput({
      combatants: [
        makeCombatant({
          combatantId: PLAYER_ID,
          name: 'Hero',
          team: 'player',
          position: { x: 0, y: 0 },
          initiative: 20,
          abilityIds: ['basic_melee', 'heavy_melee', 'bow_shot', 'guard', 'focus'],
        }),
        makeCombatant({
          combatantId: GOBLIN_1,
          name: 'Goblin Scout',
          team: 'enemy',
          position: { x: 4, y: 0 },
        }),
      ],
    }),
  );

/** Hero granted only the basic melee ability — the `abilityNotAvailable` case. */
const basicOnlyState = (): CombatState =>
  createCombatState(
    createInput({
      combatants: [
        makeCombatant({
          combatantId: PLAYER_ID,
          name: 'Hero',
          team: 'player',
          position: { x: 0, y: 0 },
          initiative: 20,
          abilityIds: ['basic_melee'],
        }),
        makeCombatant({
          combatantId: GOBLIN_1,
          name: 'Goblin Scout',
          team: 'enemy',
          position: { x: 4, y: 0 },
        }),
      ],
    }),
  );

/** Hero at (0,0) with two hostiles at equal distance — the AC-5 ambiguity case. */
const tiedState = (): CombatState =>
  createCombatState(
    createInput({
      combatants: [
        makeCombatant({
          combatantId: PLAYER_ID,
          name: 'Hero',
          team: 'player',
          position: { x: 0, y: 0 },
          initiative: 20,
          abilityIds: ['basic_melee'],
        }),
        makeCombatant({
          combatantId: GOBLIN_1,
          name: 'Goblin Scout',
          team: 'enemy',
          position: { x: 1, y: 0 },
        }),
        makeCombatant({
          combatantId: GOBLIN_2,
          name: 'Goblin Archer',
          team: 'enemy',
          position: { x: 0, y: 1 },
        }),
      ],
    }),
  );

// ---------------------------------------------------------------------------
// AC-3: selector resolution
// ---------------------------------------------------------------------------

describe('resolveEntitySelector (AC-3)', () => {
  it('orders nearest hostiles by distance then id, and reports no tie when unique', () => {
    const state = baseState();
    const resolved = resolveEntitySelector({
      state,
      actorId: PLAYER_ID,
      selector: { kind: 'nearest_hostile' },
    });
    expect(resolved.ordered).toEqual([GOBLIN_1, GOBLIN_2]);
    expect(resolved.ambiguous).toEqual([]);
  });

  it('reports every hostile tied for nearest as ambiguous', () => {
    const resolved = resolveEntitySelector({
      state: tiedState(),
      actorId: PLAYER_ID,
      selector: { kind: 'nearest_hostile' },
    });
    expect(resolved.ordered).toEqual([GOBLIN_1, GOBLIN_2]);
    expect(resolved.ambiguous).toEqual([GOBLIN_1, GOBLIN_2]);
  });

  it('resolves an explicit name reference', () => {
    const resolved = resolveEntitySelector({
      state: baseState(),
      actorId: PLAYER_ID,
      selector: { kind: 'explicit', namedRef: 'Goblin Archer' },
    });
    expect(resolved.ordered).toEqual([GOBLIN_2]);
  });

  it('review F10: excludes a surrendered hostile from nearest-hostile grounding', () => {
    const state = baseState();
    // The nearest hostile yields; the semantic selector must not offer it as
    // "the nearest hostile" only for the kernel to refuse the command.
    state.participation[GOBLIN_1] = {
      ...(state.participation[GOBLIN_1] ?? {
        status: 'active',
        morale: 100,
        appliedTriggerIds: [],
        reactionPolicy: 'ask',
      }),
      status: 'surrendered',
    };
    const resolved = resolveEntitySelector({
      state,
      actorId: PLAYER_ID,
      selector: { kind: 'nearest_hostile' },
    });
    expect(resolved.ordered).not.toContain(GOBLIN_1);
    expect(resolved.ordered).toContain(GOBLIN_2);
    expect(resolved.ambiguous).toEqual([]);
  });

  it('review F10: excludes an escaped hostile from explicit-name grounding', () => {
    const state = baseState();
    state.participation[GOBLIN_2] = {
      ...(state.participation[GOBLIN_2] ?? {
        status: 'active',
        morale: 100,
        appliedTriggerIds: [],
        reactionPolicy: 'ask',
      }),
      status: 'escaped',
    };
    const resolved = resolveEntitySelector({
      state,
      actorId: PLAYER_ID,
      selector: { kind: 'explicit', namedRef: 'Goblin Archer' },
    });
    expect(resolved.ordered).toEqual([]);
  });

  it('resolves history selectors and rejects a defeated history entry', () => {
    const state = createCombatState(
      createInput({
        combatants: [
          makeCombatant({
            combatantId: PLAYER_ID,
            name: 'Hero',
            team: 'player',
            abilityIds: ['basic_melee', 'heavy_melee', 'bow_shot', 'guard', 'focus'],
          }),
          makeCombatant({
            combatantId: GOBLIN_1,
            name: 'Goblin Scout',
            team: 'enemy',
            position: { x: 1, y: 0 },
            defeated: true,
          }),
        ],
      }),
    );
    expect(
      resolveEntitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'last_attacker' },
        history: { lastAttackerId: GOBLIN_1 },
      }).ordered,
    ).toEqual([]);
    expect(
      resolveEntitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'last_attacker' },
      }).ordered,
    ).toEqual([]);
  });
});

describe('resolveAbilitySelector (AC-3)', () => {
  it('matches a tag against ability id, kind and name', () => {
    const state = baseState();
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'tag', value: 'basic_melee' },
      }),
    ).toEqual(['basic_melee']);
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'tag', value: 'melee_attack' },
      }),
    ).toEqual(['basic_melee', 'heavy_melee']);
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'tag', value: 'basic melee' },
      }),
    ).toEqual(['basic_melee']);
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'tag', value: 'heavy_melee' },
      }),
    ).toEqual(['heavy_melee']);
  });

  it('ranks "strongest" by mean damage with a stable id tie-break', () => {
    const state = baseState();
    expect(
      resolveAbilitySelector({ state, actorId: PLAYER_ID, selector: { kind: 'strongest' } }),
    ).toEqual(['heavy_melee', 'bow_shot', 'basic_melee']);
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'strongest', damageType: 'piercing' },
      }),
    ).toEqual(['bow_shot']);
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'strongest', damageType: 'fire' },
      }),
    ).toEqual([]);
  });

  it('never resolves an ability the actor was not granted', () => {
    const state = createCombatState(
      createInput({
        combatants: [
          makeCombatant({
            combatantId: PLAYER_ID,
            name: 'Hero',
            team: 'player',
            abilityIds: ['basic_melee'],
          }),
          makeCombatant({
            combatantId: GOBLIN_1,
            name: 'Goblin Scout',
            team: 'enemy',
            position: { x: 1, y: 0 },
          }),
        ],
      }),
    );
    expect(
      resolveAbilitySelector({
        state,
        actorId: PLAYER_ID,
        selector: { kind: 'tag', value: 'heavy_melee' },
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-3: compiled plans
// ---------------------------------------------------------------------------

describe('compileActionIntent (AC-3)', () => {
  it('grounds "nearest hostile" + basic melee into a useAbility command with a forecast', () => {
    const state = baseState();
    const result = compileActionIntent({
      state,
      intent: intentWith([
        useAbility({ kind: 'tag', value: 'melee_attack' }, { kind: 'nearest_hostile' }),
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== 'plan') {
      throw new Error('expected a plan');
    }
    expect(result.plan.command).toEqual({
      kind: 'useAbility',
      combatantId: PLAYER_ID,
      abilityId: 'basic_melee',
      targetIds: [GOBLIN_1],
    });
    expect(result.plan.forecast.actionCost).toBe('action');
    expect(result.plan.forecast.hitChance).toBeGreaterThan(0);
    expect(result.plan.forecast.damageRange).toEqual({ minimum: 1, maximum: 6 });
    expect(result.plan.basedOnRevision).toBe(state.stateRevision);
    expect(result.plan.encounterId).toBe(state.encounterId);
    expect(result.plan.intentId).toBe('intent-1');
  });

  it('grounds a move to a standoff band around the nearest hostile', () => {
    const result = compileActionIntent({
      state: distantState(),
      intent: intentWith([
        {
          kind: 'move',
          destination: { kind: 'relative', relativeTo: { kind: 'nearest_hostile' }, band: 'melee' },
        },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== 'plan') {
      throw new Error('expected a plan');
    }
    expect(result.plan.command.kind).toBe('move');
    if (result.plan.command.kind !== 'move') {
      throw new Error('expected a move');
    }
    // The standoff is adjacent to the goblin at (4,0), approached from the west.
    // The shared fixture blocks (2,0), so the shortest legal route detours one
    // row south: (1,0) → (1,1) → (2,1) → (3,1) → (3,0).
    expect(result.plan.command.path.at(-1)).toEqual({ x: 3, y: 0 });
    expect(result.plan.command.path.length).toBe(5);
    expect(result.plan.forecast.movementCost).toBe(5);
    expect(result.plan.assumptions.length).toBeGreaterThan(0);
  });

  it('grounds "somewhere safe" into the reachable cell farthest from every hostile', () => {
    const result = compileActionIntent({
      state: distantState(),
      intent: intentWith([{ kind: 'move', destination: { kind: 'nearest_safe' } }]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== 'plan') {
      throw new Error('expected a plan');
    }
    if (result.plan.command.kind !== 'move') {
      throw new Error('expected a move');
    }
    const destination = result.plan.command.path.at(-1);
    expect(destination).toEqual({ x: 0, y: 6 });
  });

  it('compiles defend / wait / endTurn without any selector', () => {
    const cases: Array<{ step: IntentStep; kind: 'defend' | 'wait' | 'endTurn' }> = [
      { step: { kind: 'defend' }, kind: 'defend' },
      { step: { kind: 'wait' }, kind: 'wait' },
      { step: { kind: 'end_turn' }, kind: 'endTurn' },
    ];
    for (const { step, kind } of cases) {
      const result = compileActionIntent({ state: baseState(), intent: intentWith([step]) });
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== 'plan') {
        throw new Error('expected a plan');
      }
      expect(result.plan.command.kind).toBe(kind);
    }
  });

  it('is deterministic: the same intent over the same revision compiles byte-identically', () => {
    const state = baseState();
    const intent = intentWith([
      useAbility({ kind: 'tag', value: 'melee_attack' }, { kind: 'nearest_hostile' }),
    ]);
    const first = compileActionIntent({ state, intent });
    const second = compileActionIntent({ state, intent });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('never mutates the state it reads', () => {
    const state = deepFreeze(baseState());
    const before = JSON.stringify(state);
    compileActionIntent({
      state,
      intent: intentWith([
        useAbility({ kind: 'tag', value: 'melee_attack' }, { kind: 'nearest_hostile' }),
      ]),
    });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects a stale revision instead of compiling against newer state', () => {
    const result = compileActionIntent({
      state: baseState(),
      intent: intentWith([{ kind: 'defend' }], { basedOnRevision: 7 }),
    });
    expect(result).toEqual({
      ok: false,
      reasonCode: 'staleRevision',
      messageKey: 'combat.invalid.stale_revision',
    });
  });

  it('rejects an intent grounded in another encounter', () => {
    const result = compileActionIntent({
      state: baseState(),
      intent: intentWith([{ kind: 'defend' }], { encounterId: 'another-encounter' }),
    });
    expect(result).toEqual({
      ok: false,
      reasonCode: 'targetInvalid',
      messageKey: 'combat.invalid.target_invalid',
    });
  });

  it('rejects an ended encounter and an unknown actor', () => {
    const ended = { ...baseState(), phase: 'ended' as const };
    expect(compileActionIntent({ state: ended, intent: intentWith([{ kind: 'defend' }]) }).ok).toBe(
      false,
    );
    const unknownActor = compileActionIntent({
      state: baseState(),
      intent: intentWith([{ kind: 'defend' }], { actorId: 'nobody' }),
    });
    expect(unknownActor.ok).toBe(false);
    if (!unknownActor.ok) {
      expect(unknownActor.reasonCode).toBe('actorUnknown');
    }
  });

  it('never fabricates a capability for an unsatisfiable selector', () => {
    const cases: Array<{ state: CombatState; step: IntentStep; reasonCode: CombatInvalidReason }> =
      [
        {
          state: distantState(),
          step: useAbility(
            { kind: 'tag', value: 'melee_attack' },
            { kind: 'explicit', namedRef: 'dragon' },
          ),
          reasonCode: 'targetInvalid',
        },
        {
          state: distantState(),
          step: useAbility({ kind: 'tag', value: 'meteor_swarm' }, { kind: 'nearest_hostile' }),
          reasonCode: 'abilityUnknown',
        },
        {
          state: distantState(),
          step: useAbility({ kind: 'strongest', damageType: 'fire' }, { kind: 'nearest_hostile' }),
          reasonCode: 'abilityNotAvailable',
        },
        {
          state: basicOnlyState(),
          step: useAbility({ kind: 'tag', value: 'heavy_melee' }, { kind: 'nearest_hostile' }),
          reasonCode: 'abilityNotAvailable',
        },
        {
          state: distantState(),
          step: useAbility({ kind: 'tag', value: 'basic_melee' }, { kind: 'nearest_hostile' }),
          reasonCode: 'targetOutOfRange',
        },
      ];
    for (const { state, step, reasonCode } of cases) {
      const result = compileActionIntent({ state, intent: intentWith([step]) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasonCode).toBe(reasonCode);
      }
    }
  });

  it('reports a multi-step intent as a partial plan rather than dropping the step silently', () => {
    const result = compileActionIntent({
      state: distantState(),
      intent: intentWith([
        {
          kind: 'move',
          destination: { kind: 'relative', relativeTo: { kind: 'nearest_hostile' }, band: 'melee' },
        },
        useAbility({ kind: 'tag', value: 'basic_melee' }, { kind: 'nearest_hostile' }),
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== 'plan') {
      throw new Error('expected a plan');
    }
    expect(result.plan.command.kind).toBe('move');
    expect(result.plan.assumptions.join(' ')).toContain('partial');
  });
});

// ---------------------------------------------------------------------------
// AC-5: clarification policy
// ---------------------------------------------------------------------------

describe('decideIntentClarification / compile clarification policy (AC-5)', () => {
  const candidateOf = (targetId: string): IntentPlanCandidate => ({
    step: useAbility({ kind: 'tag', value: 'basic_melee' }, { kind: 'nearest_hostile' }),
    plan: {
      planId: `intent-1:${targetId}`,
      intentId: 'intent-1',
      encounterId: 'encounter',
      actorId: PLAYER_ID,
      basedOnRevision: 0,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'basic_melee',
        targetIds: [targetId],
      },
      forecast: {
        actionCost: 'action',
        affectedCells: [],
        affectedEntityIds: [targetId],
        reactionRisks: [],
        objectiveEffects: [],
        warnings: [],
      },
      assumptions: [],
      warnings: [],
    },
  });

  it('asks nothing for a single reading', () => {
    expect(decideIntentClarification([candidateOf(GOBLIN_1)])).toBeNull();
    expect(decideIntentClarification([])).toBeNull();
  });

  it('asks nothing when every reading is mechanically identical', () => {
    const a = candidateOf(GOBLIN_1);
    const b = candidateOf(GOBLIN_1);
    expect(decideIntentClarification([a, b])).toBeNull();
  });

  it('asks one bounded round with concrete options when readings differ', () => {
    const request = decideIntentClarification([candidateOf(GOBLIN_1), candidateOf(GOBLIN_2)]);
    expect(request).not.toBeNull();
    expect(request?.questionKey).toBe('combat.clarify.target');
    expect(request?.options.map((option) => option.optionId)).toEqual(['option-1', 'option-2']);
    expect(request?.options[0]?.steps[0]?.kind).toBe('use_ability');
  });

  it('caps the option list at COMBAT_INTENT_BOUNDS.clarificationOptions', () => {
    const request = decideIntentClarification(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidateOf(id)),
    );
    expect(request?.options.length).toBe(4);
  });

  it('previews directly when one hostile is uniquely nearest and clarifies when two tie', () => {
    const unique = compileActionIntent({
      state: baseState(),
      intent: intentWith([
        useAbility({ kind: 'tag', value: 'melee_attack' }, { kind: 'nearest_hostile' }),
      ]),
    });
    expect(unique.ok).toBe(true);
    if (unique.ok) {
      expect(unique.kind).toBe('plan');
    }

    const tied = compileActionIntent({
      state: tiedState(),
      intent: intentWith([
        useAbility({ kind: 'tag', value: 'basic_melee' }, { kind: 'nearest_hostile' }),
      ]),
    });
    expect(tied.ok).toBe(true);
    if (!tied.ok) {
      throw new Error('expected a clarification');
    }
    expect(tied.kind).toBe('clarification');
    if (tied.kind === 'clarification') {
      expect(tied.clarification.options.length).toBe(2);
      expect(tied.plans.map((plan) => plan.planId)).toEqual(['intent-1:1', 'intent-1:2']);
      expect(tied.plans[0]?.command).toEqual({
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'basic_melee',
        targetIds: [GOBLIN_1],
      });
    }
  });
});

// Keep the fixture catalog referenced so the test fails loudly if the shared
// fixture changes shape in a way this suite depends on.
describe('fixture assumptions', () => {
  it('uses the shared ability catalog', () => {
    expect(Object.keys(ABILITY_CATALOG)).toContain('heavy_melee');
    expect(BATTLEFIELD.width).toBe(8);
  });
});
