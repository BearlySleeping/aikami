// packages/shared/utils/src/lib/rules/__tests__/combat_environment_bundle.test.ts
//
// C-531 AC-1 / AC-6: authored content-pack props and encounter placements
// compile into the pinned environmental bundle and the initial state, and the
// compiled result resolves through the same kernel registry.
//
// Contract: C-531 AC-1, AC-6

import { describe, expect, it } from 'bun:test';
import { COMBAT_ENVIRONMENT_BUNDLE_VERSION } from '@aikami/schemas';
import type { ContentPackProp, ImpactZoneDefinition } from '@aikami/types';
import { buildEnvironmentFromContent } from '../combat_environment_bundle';
import { COMBAT_RULES_VERSION, createCombatState, resolveCombatCommand } from '../combat_kernel';

const prop = (overrides: Partial<ContentPackProp> & { name: string }): ContentPackProp => ({
  frame: `${overrides.name}.png`,
  ...overrides,
});

const PROPS: Record<string, ContentPackProp> = {
  'emberwatch/brazier': prop({
    name: 'Brazier',
    isWalkable: true,
    environment: {
      durability: 4,
      affordances: [
        {
          affordanceId: 'tip_over',
          name: 'Tip over',
          actionCost: 'action',
          requirements: [{ kind: 'adjacent', value: true }],
          check: null,
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
          failureEffects: [],
        },
      ],
    },
  }),
  'emberwatch/support': prop({
    name: 'Rotting Support',
    isWalkable: false,
    environment: {
      durability: 3,
      cover: 'half',
      blocksSight: false,
      affordances: [
        {
          affordanceId: 'cut_support',
          name: 'Cut the support',
          actionCost: 'action',
          requirements: [{ kind: 'adjacent', value: true }],
          check: null,
          successEffects: [
            { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
            { kind: 'dropPayload', objectSelector: 'source', impactZone: 'emberwatch/crate_zone' },
          ],
          failureEffects: [],
        },
      ],
    },
  }),
  'emberwatch/crate': prop({
    name: 'Crate',
    isWalkable: false,
    environment: { durability: 5 },
  }),
  'emberwatch/decor': prop({ name: 'Decor' }),
};

const IMPACT_ZONES: Record<string, ImpactZoneDefinition> = {
  'emberwatch/crate_zone': {
    zoneId: 'emberwatch/crate_zone',
    offsets: [{ x: 0, y: 0 }],
    diceExpression: '2d6',
    damageType: 'bludgeoning',
  },
};

const PLACEMENTS = [
  { objectId: 'emberwatch/brazier-1', propId: 'emberwatch/brazier', cell: { x: 1, y: 2 } },
  { objectId: 'emberwatch/support-1', propId: 'emberwatch/support', cell: { x: 3, y: 2 } },
  {
    objectId: 'emberwatch/crate-1',
    propId: 'emberwatch/crate',
    cell: { x: 3, y: 1 },
    attachedToObjectId: 'emberwatch/support-1',
  },
];

describe('buildEnvironmentFromContent (C-531 AC-1)', () => {
  it('compiles authored props and placements into a pinned bundle and initial state', () => {
    const result = buildEnvironmentFromContent({
      props: PROPS,
      objects: PLACEMENTS,
      impactZones: IMPACT_ZONES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.bundle.bundleVersion).toBe(COMBAT_ENVIRONMENT_BUNDLE_VERSION);
    expect(Object.keys(result.bundle.objectDefinitions).sort()).toEqual([
      'emberwatch/brazier',
      'emberwatch/crate',
      'emberwatch/support',
    ]);
    expect(result.bundle.objectDefinitions['emberwatch/brazier'].affordanceIds).toEqual([
      'tip_over',
    ]);
    expect(result.bundle.affordances.tip_over).toBeDefined();
    expect(result.bundle.affordances.cut_support).toBeDefined();

    expect(Object.keys(result.state.objects).sort()).toEqual([
      'emberwatch/brazier-1',
      'emberwatch/crate-1',
      'emberwatch/support-1',
    ]);
    const crate = result.state.objects['emberwatch/crate-1'];
    expect(crate.attachedToObjectId).toBe('emberwatch/support-1');
    expect(crate.footprint).toEqual([{ x: 0, y: 0 }]);
    expect(crate.state).toBe('intact');
    expect(result.state.surfaces).toEqual([]);
  });

  it('derives movement blocking from the prop walkability unless the environment block overrides it', () => {
    const result = buildEnvironmentFromContent({
      props: PROPS,
      objects: PLACEMENTS,
      impactZones: IMPACT_ZONES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.bundle.objectDefinitions['emberwatch/brazier'].blocksMovement).toBe(false);
    expect(result.bundle.objectDefinitions['emberwatch/support'].blocksMovement).toBe(true);
    expect(result.bundle.objectDefinitions['emberwatch/support'].cover).toBe('half');
  });

  it('rejects a placement whose prop declares no environment block', () => {
    const result = buildEnvironmentFromContent({
      props: PROPS,
      objects: [{ objectId: 'decor-1', propId: 'emberwatch/decor', cell: { x: 0, y: 0 } }],
      impactZones: IMPACT_ZONES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.includes('emberwatch/decor'))).toBe(true);
  });

  it('rejects duplicate object ids', () => {
    const result = buildEnvironmentFromContent({
      props: PROPS,
      objects: [...PLACEMENTS, PLACEMENTS[0]],
      impactZones: IMPACT_ZONES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.includes('duplicate object id'))).toBe(true);
  });

  it('reports authored object and affordance ids beyond the environment bound', () => {
    const longId = 'x'.repeat(97);
    const result = buildEnvironmentFromContent({
      props: {
        prop: prop({
          name: 'Bounded prop',
          environment: {
            durability: 1,
            affordances: [
              {
                affordanceId: longId,
                name: 'Too long',
                actionCost: 'action',
                requirements: [],
                check: null,
                successEffects: [],
                failureEffects: [],
              },
            ],
          },
        }),
      },
      objects: [{ objectId: longId, propId: 'prop', cell: { x: 0, y: 0 } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.startsWith('object id'))).toBe(true);
    expect(result.issues.some((issue) => issue.startsWith('affordance id'))).toBe(true);
  });

  it('rejects an affordance whose dropPayload names an unregistered impact zone', () => {
    const result = buildEnvironmentFromContent({ props: PROPS, objects: PLACEMENTS });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.includes('unknown impact zone'))).toBe(true);
  });

  it('rejects a payload attached to an unknown support', () => {
    const result = buildEnvironmentFromContent({
      props: PROPS,
      objects: [
        PLACEMENTS[0],
        PLACEMENTS[1],
        { ...PLACEMENTS[2], attachedToObjectId: 'emberwatch/ghost' },
      ],
      impactZones: IMPACT_ZONES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.includes('unknown support'))).toBe(true);
  });

  it('resolves the compiled encounter through the same kernel registry', () => {
    const built = buildEnvironmentFromContent({
      props: PROPS,
      objects: PLACEMENTS,
      impactZones: IMPACT_ZONES,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const state = createCombatState({
      encounterId: 'emberwatch/proof_encounter',
      rulesVersion: COMBAT_RULES_VERSION,
      seed: 99,
      combatants: [
        {
          combatantId: 'player-hero',
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
        },
      ],
      abilityCatalog: {},
      battlefield: { width: 10, height: 10, blockedCells: [] },
      environment: built.state,
      environmentBundle: built.bundle,
    });

    const tipped = resolveCombatCommand({
      state,
      command: {
        kind: 'interactWithObject',
        combatantId: 'player-hero',
        objectId: 'emberwatch/brazier-1',
        affordanceId: 'tip_over',
        targetObjectId: null,
      },
      basedOnRevision: state.stateRevision,
    });
    expect(tipped.valid).toBe(true);
    if (!tipped.valid) {
      return;
    }
    expect(tipped.state.environment.objects['emberwatch/brazier-1'].state).toBe('broken');
    expect(tipped.state.environment.surfaces).toHaveLength(1);
    expect(tipped.state.environment.surfaces[0].kind).toBe('fire');
  });
});
