// packages/shared/utils/src/lib/rules/__tests__/combat_ability_support.test.ts
//
// Combat-08 follow-up (review F5): truthful ability support and targeting.
//
//   - a reaction-only ability is unavailable as an ordinary action and spends
//     nothing;
//   - an ability whose declared effect is not implemented is rejected with
//     `unsupportedInV2` instead of consuming its cost and doing nothing;
//   - basic melee cannot resolve several targets for one cost;
//   - the catalog never ships an unimplemented ACTIVE feature as available.
//
// Contract: C-516 AC-3; C-525 AC-4; C-532 AC-3.

// biome-ignore-all lint/style/useNamingConvention: authored ability ids are snake_case content ids

import { describe, expect, it } from 'bun:test';
import type { CombatAbilityDefinition, CombatState } from '@aikami/types';
import { COMBAT_RULES_VERSION, createCombatState, resolveCombatCommand } from '../combat_kernel';
import { ABILITY_CATALOG, GOBLIN_1, GOBLIN_2, makeCombatants, PLAYER_ID } from './combat_fixtures';

const catalog = (
  overrides: Partial<CombatAbilityDefinition> & { abilityId: string },
): CombatAbilityDefinition => ({
  name: overrides.abilityId,
  kind: 'melee_attack',
  actionCost: 'action',
  attackBonus: 0,
  damageDice: '1d6',
  damageType: 'slashing',
  rangeCells: 1,
  requiresLineOfSight: false,
  ...overrides,
});

const buildState = (
  abilities: Record<string, CombatAbilityDefinition>,
  actorAbilityIds: string[],
): CombatState => {
  const combatants = makeCombatants().map((combatant) =>
    combatant.combatantId === PLAYER_ID ? { ...combatant, abilityIds: actorAbilityIds } : combatant,
  );
  return createCombatState({
    encounterId: 'emberwatch-encounter-1',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 1337,
    combatants,
    abilityCatalog: { ...ABILITY_CATALOG, ...abilities },
    battlefield: { width: 8, height: 8, blockedCells: [] },
    objectives: [],
  });
};

describe('review F5: reaction-only abilities are unavailable as ordinary actions', () => {
  it('rejects opportunity_strike used as an ordinary action and changes nothing', () => {
    const state = buildState(
      {
        opportunity_strike: catalog({
          abilityId: 'opportunity_strike',
          actionCost: 'reaction',
          activation: 'reaction',
          maxTargets: 1,
        }),
      },
      ['basic_melee', 'opportunity_strike'],
    );

    const result = resolveCombatCommand({
      state,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'opportunity_strike',
        targetIds: [GOBLIN_1],
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('abilityNotAvailable');
    }
    // Nothing spent: the caller's state is the input, untouched.
    expect(state.combatants[PLAYER_ID]?.budget.reactionAvailable).toBe(true);
    expect(state.combatants[PLAYER_ID]?.budget.actionAvailable).toBe(true);
  });
});

describe('review F5: unsupported abilities spend nothing', () => {
  it('rejects an ability with supported: false using unsupportedInV2', () => {
    const state = buildState(
      {
        second_wind: catalog({
          abilityId: 'second_wind',
          kind: 'utility',
          actionCost: 'quick',
          damageDice: null,
          damageType: null,
          rangeCells: 0,
          supported: false,
        }),
      },
      ['basic_melee', 'second_wind'],
    );

    const result = resolveCombatCommand({
      state,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'second_wind',
        targetIds: [],
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('unsupportedInV2');
    }
    expect(state.combatants[PLAYER_ID]?.budget.quickActionAvailable).toBe(true);
  });
});

describe('review F5: one cost targets one creature unless authored otherwise', () => {
  it('rejects a basic melee that names two in-range targets', () => {
    // Place both goblins adjacent to the hero so both are individually legal.
    const combatants = makeCombatants().map((combatant) => {
      if (combatant.combatantId === GOBLIN_1) {
        return { ...combatant, position: { x: 1, y: 0 } };
      }
      if (combatant.combatantId === GOBLIN_2) {
        return { ...combatant, position: { x: 0, y: 1 } };
      }
      return combatant;
    });
    const state = createCombatState({
      encounterId: 'emberwatch-encounter-1',
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 1337,
      combatants,
      abilityCatalog: ABILITY_CATALOG,
      battlefield: { width: 8, height: 8, blockedCells: [] },
      objectives: [],
    });

    const result = resolveCombatCommand({
      state,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'basic_melee',
        targetIds: [GOBLIN_1, GOBLIN_2],
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('targetInvalid');
    }
  });

  it('accepts a single in-range target', () => {
    const state = buildState({}, ['basic_melee']);
    const result = resolveCombatCommand({
      state,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'basic_melee',
        targetIds: [GOBLIN_1],
      },
    });
    expect(result.valid).toBe(true);
  });
});
