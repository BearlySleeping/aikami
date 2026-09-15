// packages/shared/schemas/src/lib/game/content_pack_environment.ts
//
// C-531 environmental authoring schemas for content packs.
//
// A prop that declares a `ContentPackPropEnvironmentSchema` becomes a usable
// battlefield object; an encounter that declares a
// `ContentPackEncounterEnvironmentSchema` places instances of those props and
// registers the impact zones its `dropPayload` effects reference.
//
// These EXTEND the prop and encounter definitions — they never replace them
// with a parallel object catalog.
//
// Contract: C-531 AC-1, AC-6

import Type, { type Static } from 'typebox';
import {
  AffordanceDefinitionSchema,
  CoverLevelSchema,
  ImpactZoneDefinitionSchema,
} from './combat/combat_environment.ts';
import { GridPointSchema } from './combat/combat_grid.ts';

/**
 * The environmental half of a prop definition (C-531).
 *
 * A prop that declares this becomes a usable battlefield object: the engine
 * derives its `BattlefieldObjectDefinition` and registers its affordances. The
 * registry EXTENDS `ContentPackPropSchema` — it never replaces it with a
 * parallel object catalog.
 */
export const ContentPackPropEnvironmentSchema = Type.Object({
  /** Hit points of the object before it breaks. */
  durability: Type.Integer({ minimum: 1, maximum: 10_000 }),
  /** Blocks movement while intact. Defaults to the prop's `isWalkable` inverse. */
  blocksMovement: Type.Optional(Type.Boolean()),
  /** Blocks line of sight while intact. */
  blocksSight: Type.Optional(Type.Boolean()),
  /** Cover granted while intact. */
  cover: Type.Optional(CoverLevelSchema),
  /** Declarative affordances this prop exposes. */
  affordances: Type.Optional(Type.Array(AffordanceDefinitionSchema, { maxItems: 128 })),
});

export type ContentPackPropEnvironment = Static<typeof ContentPackPropEnvironmentSchema>;

/**
 * One authored battlefield-object placement inside an encounter (C-531).
 *
 * `objectId` is the stable identity the kernel, the save file and a replay all
 * use — never a runtime entity id. `propId` resolves to a
 * {@link ContentPackPropSchema} entry whose `environment` block declares the
 * object's durability and affordances.
 */
export const ContentPackEncounterObjectSchema = Type.Object({
  /** Stable authored object identity. */
  objectId: Type.String({ minLength: 1, description: 'Stable authored object id' }),
  /** Prop definition id this instance instantiates. */
  propId: Type.String({ minLength: 1, description: 'Content-pack prop id' }),
  /** Origin cell on the encounter map. */
  cell: GridPointSchema,
  /** Footprint offsets relative to `cell`; defaults to `[{x:0,y:0}]`. */
  footprint: Type.Optional(Type.Array(GridPointSchema, { minItems: 1, maxItems: 16 })),
  /** Support this object hangs from; it falls when that support breaks. */
  attachedToObjectId: Type.Optional(Type.String({ minLength: 1 })),
});

export type ContentPackEncounterObject = Static<typeof ContentPackEncounterObjectSchema>;

/**
 * The environmental half of an encounter definition (C-531).
 *
 * `objects` places instances of props whose `environment` block declares
 * durability and affordances; `impactZones` registers the zones a
 * `dropPayload` effect resolves against.
 */
export const ContentPackEncounterEnvironmentSchema = Type.Object({
  /** Authored battlefield-object placements for this encounter. */
  objects: Type.Optional(
    Type.Array(ContentPackEncounterObjectSchema, {
      maxItems: 64,
      description: 'Authored battlefield-object placements',
    }),
  ),
  /** Registered impact zones referenced by `dropPayload` effects. */
  impactZones: Type.Optional(
    Type.Record(Type.String({ minLength: 1 }), ImpactZoneDefinitionSchema),
  ),
});

export type ContentPackEncounterEnvironment = Static<typeof ContentPackEncounterEnvironmentSchema>;
