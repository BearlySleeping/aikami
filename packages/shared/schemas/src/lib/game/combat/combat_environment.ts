// packages/shared/schemas/src/lib/game/combat/combat_environment.ts
//
// Combat-07 environmental wire contract: authored objects, registered
// affordances, the closed v1 effect vocabulary, surfaces and hazard ticks.
//
// The environmental layer is DECLARATIVE. It extends the existing content-pack
// prop/encounter definitions (`ContentPackPropSchema`) instead of forking a
// parallel object catalog: `BattlefieldObject.definitionId` resolves to a prop
// id, and `BattlefieldObjectDefinition` adds the durability / affordance /
// interaction fields the prop schema does not carry.
//
// The `RegisteredEffect` union is CLOSED. A new variant is a schema/rules
// version bump and an amendment — never a model-supplied effect. The same is
// true of `SurfaceKind` (`"oil" | "fire"`): a new surface family requires a
// version bump, not a silent widening.
//
// Contract: C-531 AC-1, AC-2, AC-3, AC-7

import Type, { type Static } from 'typebox';
import { DamageTypeKeySchema } from '../damage_type';
import { GridPointSchema } from './combat_grid';

// ---------------------------------------------------------------------------
// Versions and bounds
// ---------------------------------------------------------------------------

/** Current wire version of {@link CombatEnvironmentBundleSchema}. */
export const COMBAT_ENVIRONMENT_BUNDLE_VERSION = 1;

/**
 * Hard caps for the environmental vocabulary.
 *
 * Every array, string, coordinate and dice expression in this module is
 * bounded so authored content and model output cannot make resolution
 * unbounded (architecture §20).
 */
export const COMBAT_ENVIRONMENT_BOUNDS = {
  /** Maximum characters of any authored/derived id. */
  idChars: 96,
  /** Maximum length of a display name or selector reference. */
  nameChars: 96,
  /** Maximum `affordanceIds` on one object definition. */
  affordanceIds: 16,
  /** Maximum authored object definitions in one bundle. */
  objectDefinitions: 128,
  /** Maximum authored affordances in one bundle. */
  affordances: 128,
  /** Maximum authored impact zones in one bundle. */
  impactZones: 32,
  /** Maximum live battlefield objects. */
  objects: 64,
  /** Maximum live surface cells. */
  surfaces: 256,
  /** Maximum recorded hazard tick stamps. */
  hazardTickStamps: 512,
  /** Maximum cells in one object footprint / impact zone. */
  cells: 16,
  /** Maximum declarative requirements on one affordance. */
  requirements: 8,
  /** Maximum registered effects on one success/failure branch. */
  effects: 8,
  /** Maximum cells of forced movement in one effect. */
  forcedMovementCells: 12,
  /** Maximum cells an object may be moved in one effect. */
  moveObjectCells: 12,
  /** Hard cascade bound per initiating command (architecture §13). */
  effectExpansion: 64,
  /** Maximum durability an authored object may declare. */
  durability: 10_000,
  /** Maximum authored check DC. */
  checkDc: 60,
  /** Maximum battlefield extent any authored coordinate may reference. */
  gridExtent: 256,
} as const;

/** Dice expression grammar shared by abilities and environmental effects. */
export const COMBAT_ENVIRONMENT_DICE_PATTERN = '^\\d{1,2}d\\d{1,3}(\\+\\d{1,3})?$';

const BoundedIdSchema = Type.String({ minLength: 1, maxLength: COMBAT_ENVIRONMENT_BOUNDS.idChars });
const BoundedNameSchema = Type.String({
  minLength: 1,
  maxLength: COMBAT_ENVIRONMENT_BOUNDS.nameChars,
});

// ---------------------------------------------------------------------------
// Closed value vocabularies
// ---------------------------------------------------------------------------

/** Durability lifecycle of an authored object. */
export const ObjectStateSchema = Type.Union([Type.Literal('intact'), Type.Literal('broken')]);

export type ObjectState = Static<typeof ObjectStateSchema>;

/**
 * Cover an object grants while it is intact.
 *
 * `half` grants a `+2` AC modifier and `full` a `+5` modifier (the registered
 * rule in `@aikami/utils`' `combat_environment.ts`); destroying the object
 * removes the modifier because a broken object grants `none`.
 */
export const CoverLevelSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('half'),
  Type.Literal('full'),
]);

export type CoverLevel = Static<typeof CoverLevelSchema>;

/**
 * The closed v1 surface vocabulary.
 *
 * Widening this union is a schema/rules version bump plus an amendment — it is
 * never a silent addition.
 */
export const SurfaceKindSchema = Type.Union([Type.Literal('oil'), Type.Literal('fire')]);

export type SurfaceKind = Static<typeof SurfaceKindSchema>;

/** Every surface kind, in canonical order. */
export const SURFACE_KINDS: readonly SurfaceKind[] = ['oil', 'fire'] as const;

// ---------------------------------------------------------------------------
// Live environmental state
// ---------------------------------------------------------------------------

/**
 * One authored object in the live battlefield.
 *
 * `objectId` is stable for the life of the encounter (and, for world-persistent
 * objects, across the return to exploration); it is never a runtime entity id.
 * `definitionId` resolves to a `ContentPackPropSchema` prop definition.
 *
 * `attachedToObjectId` records a payload relationship: the payload falls when
 * its support breaks (see the `dropPayload` effect).
 */
export const BattlefieldObjectSchema = Type.Object(
  {
    objectId: BoundedIdSchema,
    definitionId: BoundedIdSchema,
    position: GridPointSchema,
    footprint: Type.Array(GridPointSchema, {
      minItems: 1,
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.cells,
    }),
    durability: Type.Integer({ minimum: 0, maximum: COMBAT_ENVIRONMENT_BOUNDS.durability }),
    state: ObjectStateSchema,
    ignited: Type.Boolean(),
    cover: CoverLevelSchema,
    affordanceIds: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.affordanceIds,
    }),
    attachedToObjectId: Type.Union([BoundedIdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type BattlefieldObject = Static<typeof BattlefieldObjectSchema>;

/**
 * One live surface cell.
 *
 * `expiresAfterRound` is absolute (the round number after which the cell is
 * removed at round advance); `null` means the surface never expires on its own.
 */
export const SurfaceCellSchema = Type.Object(
  {
    surfaceId: BoundedIdSchema,
    kind: SurfaceKindSchema,
    cell: GridPointSchema,
    expiresAfterRound: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    sourceObjectId: Type.Union([BoundedIdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type SurfaceCell = Static<typeof SurfaceCellSchema>;

/**
 * Tick identity that makes "at most one hazard hit per actor per round from the
 * same registered hazard family" replay-stable.
 */
export const HazardTickStampSchema = Type.Object(
  {
    hazardFamilyId: BoundedIdSchema,
    actorId: BoundedIdSchema,
    round: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type HazardTickStamp = Static<typeof HazardTickStampSchema>;

/** Everything the environmental layer adds to a `CombatState`. */
export const EnvironmentalStateSchema = Type.Object(
  {
    objects: Type.Record(BoundedIdSchema, BattlefieldObjectSchema, {
      maxProperties: COMBAT_ENVIRONMENT_BOUNDS.objects,
    }),
    surfaces: Type.Array(SurfaceCellSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.surfaces,
    }),
    hazardTickStamps: Type.Array(HazardTickStampSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.hazardTickStamps,
    }),
  },
  { additionalProperties: false },
);

export type EnvironmentalState = Static<typeof EnvironmentalStateSchema>;

/** The empty environmental state every non-environmental encounter carries. */
export const EMPTY_ENVIRONMENTAL_STATE: EnvironmentalState = {
  objects: {},
  surfaces: [],
  hazardTickStamps: [],
};

/** Returns a fresh empty environmental state — never the shared constant. */
export const emptyEnvironmentalState = (): EnvironmentalState => ({
  objects: {},
  surfaces: [],
  hazardTickStamps: [],
});

// ---------------------------------------------------------------------------
// Declarative requirements (validated before play; never executed)
// ---------------------------------------------------------------------------

/** Requirement kinds the v1 registry understands. */
export const MechanicalRequirementKindSchema = Type.Union([
  Type.Literal('adjacent'),
  Type.Literal('lineOfSight'),
  Type.Literal('range'),
  Type.Literal('budget'),
  Type.Literal('objectState'),
  Type.Literal('surfaceKind'),
]);

export type MechanicalRequirementKind = Static<typeof MechanicalRequirementKindSchema>;

/**
 * A declarative prerequisite.
 *
 * `value` is interpreted per `kind` by the registered requirement evaluator:
 * `adjacent`/`lineOfSight` use a boolean, `range`/`budget` an integer,
 * `objectState`/`surfaceKind` a vocabulary member. Requirements are data — they
 * never carry code and never execute.
 */
export const MechanicalRequirementSchema = Type.Object(
  {
    kind: MechanicalRequirementKindSchema,
    value: Type.Union([
      Type.String({ maxLength: COMBAT_ENVIRONMENT_BOUNDS.nameChars }),
      Type.Integer(),
      Type.Boolean(),
    ]),
  },
  { additionalProperties: false },
);

export type MechanicalRequirement = Static<typeof MechanicalRequirementSchema>;

/**
 * A check modifier must resolve to a named, projected character-sheet field.
 * Substituting an unrelated bonus (e.g. attack bonus for an Athletics check) is
 * a rejection, not a fallback.
 */
export const RegisteredCheckDefinitionSchema = Type.Object(
  {
    category: BoundedIdSchema,
    dc: Type.Integer({ minimum: 0, maximum: COMBAT_ENVIRONMENT_BOUNDS.checkDc }),
    modifierSource: BoundedIdSchema,
  },
  { additionalProperties: false },
);

export type RegisteredCheckDefinition = Static<typeof RegisteredCheckDefinitionSchema>;

// ---------------------------------------------------------------------------
// The closed v1 effect vocabulary
// ---------------------------------------------------------------------------

export const RegisteredEffectSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('damage'),
      targetSelector: BoundedIdSchema,
      diceExpression: Type.String({ pattern: COMBAT_ENVIRONMENT_DICE_PATTERN }),
      damageType: DamageTypeKeySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('setObjectState'),
      objectSelector: BoundedIdSchema,
      state: ObjectStateSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('moveObject'),
      objectSelector: BoundedIdSchema,
      steps: Type.Integer({ minimum: 0, maximum: COMBAT_ENVIRONMENT_BOUNDS.moveObjectCells }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('forcedMovement'),
      targetSelector: BoundedIdSchema,
      cells: Type.Integer({ minimum: 0, maximum: COMBAT_ENVIRONMENT_BOUNDS.forcedMovementCells }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('setIgnited'),
      objectSelector: BoundedIdSchema,
      ignited: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('createSurface'),
      surfaceKind: SurfaceKindSchema,
      cellSelector: BoundedIdSchema,
      expiresAfterRound: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('removeSurface'),
      surfaceSelector: BoundedIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('dropPayload'),
      objectSelector: BoundedIdSchema,
      impactZone: BoundedIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('setCover'),
      objectSelector: BoundedIdSchema,
      cover: CoverLevelSchema,
    },
    { additionalProperties: false },
  ),
]);

export type RegisteredEffect = Static<typeof RegisteredEffectSchema>;

/** The `kind` discriminator values of {@link RegisteredEffectSchema}. */
export type RegisteredEffectKind = RegisteredEffect['kind'];

/** Every registered effect kind, in canonical order. */
export const REGISTERED_EFFECT_KINDS: readonly RegisteredEffectKind[] = [
  'damage',
  'setObjectState',
  'moveObject',
  'forcedMovement',
  'setIgnited',
  'createSurface',
  'removeSurface',
  'dropPayload',
  'setCover',
] as const;

// ---------------------------------------------------------------------------
// Authored definitions
// ---------------------------------------------------------------------------

/**
 * One authored affordance: cost, prerequisites, check and both outcome
 * branches. Affordances are content, never code — adding a usable object means
 * composing these, not writing object-specific engine code.
 */
export const AffordanceDefinitionSchema = Type.Object(
  {
    affordanceId: BoundedIdSchema,
    name: BoundedNameSchema,
    actionCost: Type.Union([
      Type.Literal('action'),
      Type.Literal('quick'),
      Type.Literal('reaction'),
      Type.Literal('free'),
    ]),
    requirements: Type.Array(MechanicalRequirementSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.requirements,
    }),
    check: Type.Union([RegisteredCheckDefinitionSchema, Type.Null()]),
    successEffects: Type.Array(RegisteredEffectSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.effects,
    }),
    failureEffects: Type.Array(RegisteredEffectSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.effects,
    }),
  },
  { additionalProperties: false },
);

export type AffordanceDefinition = Static<typeof AffordanceDefinitionSchema>;

/**
 * The environmental half of an authored object definition.
 *
 * `definitionId` is the content-pack prop id, so the object registry extends
 * `ContentPackPropSchema` rather than replacing it.
 */
export const BattlefieldObjectDefinitionSchema = Type.Object(
  {
    definitionId: BoundedIdSchema,
    name: BoundedNameSchema,
    durability: Type.Integer({ minimum: 1, maximum: COMBAT_ENVIRONMENT_BOUNDS.durability }),
    blocksMovement: Type.Boolean(),
    blocksSight: Type.Boolean(),
    cover: CoverLevelSchema,
    affordanceIds: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.affordanceIds,
    }),
  },
  { additionalProperties: false },
);

export type BattlefieldObjectDefinition = Static<typeof BattlefieldObjectDefinitionSchema>;

/**
 * A registered impact zone: relative cell offsets plus the dice applied to
 * every combatant occupying one of those cells.
 *
 * Dropped payloads use these registered zones — never a real-time physics
 * engine.
 */
export const ImpactZoneDefinitionSchema = Type.Object(
  {
    zoneId: BoundedIdSchema,
    offsets: Type.Array(GridPointSchema, {
      minItems: 1,
      maxItems: COMBAT_ENVIRONMENT_BOUNDS.cells,
    }),
    diceExpression: Type.String({ pattern: COMBAT_ENVIRONMENT_DICE_PATTERN }),
    damageType: DamageTypeKeySchema,
  },
  { additionalProperties: false },
);

export type ImpactZoneDefinition = Static<typeof ImpactZoneDefinitionSchema>;

/**
 * The immutable replay dependency bundle pinned into the encounter snapshot.
 *
 * Replay reads these definitions — it never fetches the latest mutable content
 * pack.
 */
export const CombatEnvironmentBundleSchema = Type.Object(
  {
    bundleVersion: Type.Literal(COMBAT_ENVIRONMENT_BUNDLE_VERSION),
    rulesVersion: Type.String({ minLength: 1 }),
    objectDefinitions: Type.Record(BoundedIdSchema, BattlefieldObjectDefinitionSchema, {
      maxProperties: COMBAT_ENVIRONMENT_BOUNDS.objectDefinitions,
    }),
    affordances: Type.Record(BoundedIdSchema, AffordanceDefinitionSchema, {
      maxProperties: COMBAT_ENVIRONMENT_BOUNDS.affordances,
    }),
    impactZones: Type.Record(BoundedIdSchema, ImpactZoneDefinitionSchema, {
      maxProperties: COMBAT_ENVIRONMENT_BOUNDS.impactZones,
    }),
  },
  { additionalProperties: false },
);

export type CombatEnvironmentBundle = Static<typeof CombatEnvironmentBundleSchema>;

/** An empty bundle — the pinned dependency set of a non-environmental fight. */
export const EMPTY_ENVIRONMENT_BUNDLE: CombatEnvironmentBundle = {
  bundleVersion: COMBAT_ENVIRONMENT_BUNDLE_VERSION,
  rulesVersion: 'combat-environment-1.0.0',
  objectDefinitions: {},
  affordances: {},
  impactZones: {},
};

/** Returns a fresh empty bundle — never the shared constant. */
export const emptyEnvironmentBundle = (): CombatEnvironmentBundle => ({
  bundleVersion: COMBAT_ENVIRONMENT_BUNDLE_VERSION,
  rulesVersion: EMPTY_ENVIRONMENT_BUNDLE.rulesVersion,
  objectDefinitions: {},
  affordances: {},
  impactZones: {},
});
