// packages/shared/types/src/lib/game/combat/combat_environment.ts
//
// Combat-07 environmental domain types — derived from the TypeBox schemas in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-531 AC-1

import type {
  AffordanceDefinitionSchema,
  BattlefieldObjectDefinitionSchema,
  BattlefieldObjectSchema,
  CombatEnvironmentBundleSchema,
  CoverLevelSchema,
  EnvironmentalStateSchema,
  HazardTickStampSchema,
  ImpactZoneDefinitionSchema,
  MechanicalRequirementSchema,
  ObjectStateSchema,
  RegisteredCheckDefinitionSchema,
  RegisteredEffectSchema,
  SurfaceCellSchema,
  SurfaceKindSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type ObjectState = Static<typeof ObjectStateSchema>;
export type CoverLevel = Static<typeof CoverLevelSchema>;
export type SurfaceKind = Static<typeof SurfaceKindSchema>;
export type BattlefieldObject = Static<typeof BattlefieldObjectSchema>;
export type SurfaceCell = Static<typeof SurfaceCellSchema>;
export type HazardTickStamp = Static<typeof HazardTickStampSchema>;
export type EnvironmentalState = Static<typeof EnvironmentalStateSchema>;
export type MechanicalRequirement = Static<typeof MechanicalRequirementSchema>;
export type RegisteredCheckDefinition = Static<typeof RegisteredCheckDefinitionSchema>;
export type RegisteredEffect = Static<typeof RegisteredEffectSchema>;
export type RegisteredEffectKind = RegisteredEffect['kind'];
export type AffordanceDefinition = Static<typeof AffordanceDefinitionSchema>;
export type BattlefieldObjectDefinition = Static<typeof BattlefieldObjectDefinitionSchema>;
export type ImpactZoneDefinition = Static<typeof ImpactZoneDefinitionSchema>;
export type CombatEnvironmentBundle = Static<typeof CombatEnvironmentBundleSchema>;
