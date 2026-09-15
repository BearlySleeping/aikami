// packages/shared/utils/src/lib/rules/combat_environment_bundle.ts
//
// Compiles authored content-pack props and encounter object placements into the
// two things Combat-07 needs:
//
//   1. an immutable `CombatEnvironmentBundle` pinned into the encounter
//      snapshot (replay reads this, never the latest mutable content pack), and
//   2. the initial `EnvironmentalState` of the encounter.
//
// The compile is pure and total: every reference is resolved or reported. It
// extends `ContentPackPropSchema` / `ContentPackEncounterEntrySchema` — there is
// no parallel object catalog.
//
// Contract: C-531 AC-1, AC-6

import { COMBAT_ENVIRONMENT_BOUNDS, COMBAT_ENVIRONMENT_BUNDLE_VERSION } from '@aikami/schemas';
import type {
  AffordanceDefinition,
  BattlefieldObject,
  BattlefieldObjectDefinition,
  CombatEnvironmentBundle,
  ContentPackEncounterObject,
  ContentPackProp,
  EnvironmentalState,
  ImpactZoneDefinition,
} from '@aikami/types';
import { COMBAT_ENVIRONMENT_RULES_VERSION } from './combat_environment';

export type BuildEnvironmentOptions = {
  /** Every prop definition the pack declares, keyed by prop id. */
  props: Record<string, ContentPackProp>;
  /** Authored placements for one encounter. */
  objects?: ContentPackEncounterObject[];
  /** Registered impact zones referenced by `dropPayload` effects. */
  impactZones?: Record<string, ImpactZoneDefinition>;
  /** Bundle rules version; defaults to the current environmental rules version. */
  rulesVersion?: string;
};

export type BuiltEnvironment = {
  bundle: CombatEnvironmentBundle;
  state: EnvironmentalState;
};

export type BuildEnvironmentResult =
  | ({ ok: true } & BuiltEnvironment)
  | { ok: false; issues: string[] };

const DEFAULT_FOOTPRINT = [{ x: 0, y: 0 }];

/**
 * A prop blocks movement unless it is explicitly walkable.
 *
 * The prop schema's `isWalkable` already drives the entity spawner's collision,
 * so the environmental object definition reads the same field rather than
 * inventing a second answer.
 */
const propBlocksMovement = (prop: ContentPackProp, declared: boolean | undefined): boolean => {
  if (declared !== undefined) {
    return declared;
  }
  return prop.isWalkable !== true;
};

/**
 * Builds the pinned bundle and the initial environmental state for one
 * encounter.
 *
 * Returns `ok: false` with every issue when an authored placement references an
 * unknown prop, a duplicate object id, an affordance with an unresolvable
 * impact zone, or when the object count exceeds the registered bound.
 */
export const buildEnvironmentFromContent = (
  options: BuildEnvironmentOptions,
): BuildEnvironmentResult => {
  const issues: string[] = [];
  const objectDefinitions: Record<string, BattlefieldObjectDefinition> = {};
  const affordances: Record<string, AffordanceDefinition> = {};
  const impactZones = options.impactZones ?? {};

  for (const [propId, prop] of Object.entries(options.props)) {
    const environment = prop.environment;
    if (environment === undefined) {
      continue;
    }
    const propAffordances = environment.affordances ?? [];
    for (const affordance of propAffordances) {
      const existing = affordances[affordance.affordanceId];
      if (existing !== undefined) {
        issues.push(`duplicate affordance id "${affordance.affordanceId}"`);
        continue;
      }
      for (const effect of [...affordance.successEffects, ...affordance.failureEffects]) {
        if (effect.kind === 'dropPayload' && impactZones[effect.impactZone] === undefined) {
          issues.push(
            `affordance "${affordance.affordanceId}" references unknown impact zone "${effect.impactZone}"`,
          );
        }
      }
      affordances[affordance.affordanceId] = affordance;
    }

    objectDefinitions[propId] = {
      definitionId: propId,
      name: prop.name,
      durability: environment.durability,
      blocksMovement: propBlocksMovement(prop, environment.blocksMovement),
      blocksSight: environment.blocksSight ?? false,
      cover: environment.cover ?? 'none',
      affordanceIds: propAffordances.map((affordance) => affordance.affordanceId),
    };
  }

  const placements = options.objects ?? [];
  if (placements.length > COMBAT_ENVIRONMENT_BOUNDS.objects) {
    issues.push(
      `encounter authors ${placements.length} objects, over the ${COMBAT_ENVIRONMENT_BOUNDS.objects} bound`,
    );
  }

  const objects: Record<string, BattlefieldObject> = {};
  for (const placement of placements) {
    const definition = objectDefinitions[placement.propId];
    if (definition === undefined) {
      issues.push(
        `object "${placement.objectId}" references prop "${placement.propId}" with no environment block`,
      );
      continue;
    }
    if (objects[placement.objectId] !== undefined) {
      issues.push(`duplicate object id "${placement.objectId}"`);
      continue;
    }
    objects[placement.objectId] = {
      objectId: placement.objectId,
      definitionId: placement.propId,
      position: { x: placement.cell.x, y: placement.cell.y },
      footprint: (placement.footprint ?? DEFAULT_FOOTPRINT).map((cell) => ({
        x: cell.x,
        y: cell.y,
      })),
      durability: definition.durability,
      state: 'intact',
      ignited: false,
      cover: definition.cover,
      affordanceIds: [...definition.affordanceIds],
      attachedToObjectId: placement.attachedToObjectId ?? null,
    };
  }

  for (const object of Object.values(objects)) {
    if (object.attachedToObjectId !== null && objects[object.attachedToObjectId] === undefined) {
      issues.push(
        `object "${object.objectId}" is attached to unknown support "${object.attachedToObjectId}"`,
      );
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    bundle: {
      bundleVersion: COMBAT_ENVIRONMENT_BUNDLE_VERSION,
      rulesVersion: options.rulesVersion ?? COMBAT_ENVIRONMENT_RULES_VERSION,
      objectDefinitions,
      affordances,
      impactZones: { ...impactZones },
    },
    state: { objects, surfaces: [], hazardTickStamps: [] },
  };
};
