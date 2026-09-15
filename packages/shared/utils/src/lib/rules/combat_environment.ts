// packages/shared/utils/src/lib/rules/combat_environment.ts
//
// Combat-07 environmental registry — public entry point.
//
// The registry is DATA: authored affordances declare cost, prerequisites, a
// check and both outcome branches; the modules below are the single
// implementation that evaluates them. Adding a usable object means composing
// registered affordances — never writing object-specific engine code and never
// adding a "brazier-on-goblin" command.
//
// Module graph (must stay acyclic):
//   combat_spatial.ts                  ← combat_environment_internal.ts
//   combat_message_keys.ts             ← combat_environment_internal.ts
//   combat_environment_internal.ts     ← combat_environment_selectors.ts
//   combat_environment_selectors.ts    ← combat_environment_effects.ts
//   combat_environment_effects.ts      ← combat_environment_resolver.ts
//   combat_environment_selectors.ts    ← combat_environment_forecast.ts
//   combat_environment.ts              ← combat_kernel.ts / combat_tactical.ts
//
// The public surface is re-exported explicitly so the module split does not
// leak internal helpers (`failure`, `rejection`, occupancy lookups, dice
// helpers) into the `@aikami/utils` barrel.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-4, AC-7

export {
  forcedMovementPath,
  moveObjectAlong,
  surfaceIdFor,
} from './combat_environment_effects';
export { forecastEnvironmentalCommand } from './combat_environment_forecast';
export type {
  EnvironmentalEligibility,
  EnvironmentalGeometry,
  EnvironmentalResolution,
} from './combat_environment_internal';
export {
  COMBAT_ENVIRONMENT_RULES_VERSION,
  COVER_ARMOR_CLASS_MODIFIERS,
  coverArmorClassBonus,
  coverAt,
  getEnvironmentalGeometry,
  hasEnvironmentalLineOfSight,
  hazardFamilyForSurfaceKind,
  isEnvironmentallyBlocked,
  objectCells,
  REGISTERED_HAZARD_FAMILIES,
  sortedObjects,
  sortedSurfaces,
} from './combat_environment_internal';
export type { ApplyEnvironmentalCommandOptions } from './combat_environment_resolver';
export {
  applyEnvironmentalCommand,
  applyEnvironmentalRoundStart,
  validateEnvironmentalCommand,
  validateEnvironmentBundle,
} from './combat_environment_resolver';
export type { ObjectAffordanceView } from './combat_environment_selectors';
export {
  CELL_SELECTORS,
  COMBATANT_SELECTORS,
  evaluateAffordanceEligibility,
  getObjectAffordances,
  IMPACT_ZONE_SELECTOR_PREFIX,
  impactZoneCells,
  OBJECT_SELECTORS,
  resolveCheckModifier,
  SURFACE_SELECTORS,
  successOdds,
} from './combat_environment_selectors';
