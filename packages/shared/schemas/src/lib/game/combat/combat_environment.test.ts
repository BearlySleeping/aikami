import { describe, expect, it } from 'bun:test';
import { Value } from 'typebox/value';
import {
  COMBAT_ENVIRONMENT_BOUNDS,
  CombatEnvironmentBundleSchema,
  EnvironmentalStateSchema,
} from './combat_environment';

const recordOf = <T>(count: number, value: (index: number) => T): Record<string, T> =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`id-${index}`, value(index)]));

describe('combat environment record bounds', () => {
  it('enforces the live-object record limit', () => {
    const objects = recordOf(COMBAT_ENVIRONMENT_BOUNDS.objects + 1, (index) => ({
      objectId: `id-${index}`,
      definitionId: 'definition',
      position: { x: 0, y: 0 },
      footprint: [{ x: 0, y: 0 }],
      durability: 1,
      state: 'intact',
      ignited: false,
      cover: 'none',
      affordanceIds: [],
      attachedToObjectId: null,
    }));
    expect(
      Value.Check(EnvironmentalStateSchema, { objects, surfaces: [], hazardTickStamps: [] }),
    ).toBe(false);
  });

  it('enforces definition, affordance, and impact-zone record limits', () => {
    const objectDefinitions = recordOf(
      COMBAT_ENVIRONMENT_BOUNDS.objectDefinitions + 1,
      (index) => ({
        definitionId: `id-${index}`,
        name: 'Definition',
        durability: 1,
        blocksMovement: false,
        blocksSight: false,
        cover: 'none',
        affordanceIds: [],
      }),
    );
    const affordances = recordOf(COMBAT_ENVIRONMENT_BOUNDS.affordances + 1, (index) => ({
      affordanceId: `id-${index}`,
      name: 'Affordance',
      actionCost: 'action',
      requirements: [],
      check: null,
      successEffects: [],
      failureEffects: [],
    }));
    const impactZones = recordOf(COMBAT_ENVIRONMENT_BOUNDS.impactZones + 1, (index) => ({
      zoneId: `id-${index}`,
      offsets: [{ x: 0, y: 0 }],
      diceExpression: '1d4',
      damageType: 'fire',
    }));
    const base = {
      bundleVersion: 1,
      rulesVersion: 'combat-environment-1.0.0',
      objectDefinitions: {},
      affordances: {},
      impactZones: {},
    };

    expect(Value.Check(CombatEnvironmentBundleSchema, { ...base, objectDefinitions })).toBe(false);
    expect(Value.Check(CombatEnvironmentBundleSchema, { ...base, affordances })).toBe(false);
    expect(Value.Check(CombatEnvironmentBundleSchema, { ...base, impactZones })).toBe(false);
  });
});
