// packages/shared/schemas/src/lib/game/combat/combat_objective.ts
//
// Combat-08 authored-objective wire contract: the four initial objective
// primitives, their closed declarative rule vocabulary, and the encounter-level
// rules input that pins them.
//
// Objectives are DATA. `RegisteredObjectiveRule` is a closed union — a new
// primitive is a schema/rules version bump and an amendment, never an
// arbitrary content expression and never model-supplied code. The evaluator
// that consumes these definitions lives in `@aikami/utils`
// (`combat_objectives.ts`) and reads nothing but the pinned rules plus
// observable kernel facts.
//
// Contract: C-532 AC-1

import Type, { type Static } from 'typebox';
import { GridPointSchema } from './combat_grid';

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Hard caps for the objective vocabulary (architecture §20). */
export const COMBAT_OBJECTIVE_BOUNDS = {
  /** Maximum characters of any authored/derived id. */
  idChars: 96,
  /** Maximum authored objective definitions in one encounter. */
  definitions: 32,
  /** Maximum actors in one hostile group / required-actor list. */
  actorIds: 32,
  /** Maximum protected actors on one encounter. */
  protectedActors: 16,
  /** Maximum cells in one authored destination zone. */
  zoneCells: 64,
  /** Highest authored round boundary. */
  maxRound: 9999,
  /** Maximum completed rounds a `survive_rounds` objective may require. */
  maxRounds: 999,
} as const;

const BoundedIdSchema = Type.String({ minLength: 1, maxLength: COMBAT_OBJECTIVE_BOUNDS.idChars });

// ---------------------------------------------------------------------------
// Objective primitives
// ---------------------------------------------------------------------------

/** The four initial objective primitives. */
export const ObjectiveKindSchema = Type.Union([
  Type.Literal('defeat_or_rout'),
  Type.Literal('survive_rounds'),
  Type.Literal('interact_before_deadline'),
  Type.Literal('reach_zone'),
]);

export type ObjectiveKind = Static<typeof ObjectiveKindSchema>;

/** Every objective kind, in canonical order. */
export const OBJECTIVE_KINDS: readonly ObjectiveKind[] = [
  'defeat_or_rout',
  'survive_rounds',
  'interact_before_deadline',
  'reach_zone',
] as const;

const actorIdList = () =>
  Type.Array(BoundedIdSchema, { minItems: 1, maxItems: COMBAT_OBJECTIVE_BOUNDS.actorIds });

/**
 * A closed, declarative objective rule.
 *
 * Each variant names only authored ids, thresholds and boundaries. A
 * `defeat_or_rout` group is routed only when every named hostile has actually
 * LEFT participation (`defeated`, `escaped` or `surrendered`). Crossing a
 * morale threshold merely *permits* an authored response; it never removes an
 * actor by itself, so a low-morale enemy still contesting the battlefield is
 * still a participant and does not satisfy the objective. Contract: C-532 AC-1,
 * AC-2.
 */
export const RegisteredObjectiveRuleSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('defeat_or_rout'),
      /** The specified hostile group that must stop contesting the encounter. */
      hostileIds: actorIdList(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('survive_rounds'),
      /** Completed rounds the required actors must remain eligible through. */
      rounds: Type.Integer({ minimum: 1, maximum: COMBAT_OBJECTIVE_BOUNDS.maxRounds }),
      requiredActorIds: actorIdList(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('interact_before_deadline'),
      /** Authored object the registered interaction must be completed on. */
      objectId: BoundedIdSchema,
      /** Registered affordance that counts as completing the objective. */
      affordanceId: BoundedIdSchema,
      /** Last round boundary at which the interaction is still legal. */
      deadlineRound: Type.Integer({ minimum: 1, maximum: COMBAT_OBJECTIVE_BOUNDS.maxRound }),
      requiredActorIds: actorIdList(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('reach_zone'),
      /** Authored destination-zone identity (also the reach-zone fact key). */
      zoneId: BoundedIdSchema,
      /** The destination cells. */
      cells: Type.Array(GridPointSchema, {
        minItems: 1,
        maxItems: COMBAT_OBJECTIVE_BOUNDS.zoneCells,
      }),
      requiredActorIds: actorIdList(),
    },
    { additionalProperties: false },
  ),
]);

export type RegisteredObjectiveRule = Static<typeof RegisteredObjectiveRuleSchema>;

/** The `kind` discriminator values of {@link RegisteredObjectiveRuleSchema}. */
export type RegisteredObjectiveRuleKind = RegisteredObjectiveRule['kind'];

// ---------------------------------------------------------------------------
// Authored definitions and progress
// ---------------------------------------------------------------------------

const ObjectiveDefinitionObjectSchema = Type.Object(
  {
    objectiveId: BoundedIdSchema,
    /** The primitive this objective presents. Must match `rule.kind`. */
    kind: ObjectiveKindSchema,
    /**
     * A required objective must be complete for a victory. Failing one is a
     * mandatory loss constraint and wins same-boundary ties.
     */
    required: Type.Boolean(),
    /**
     * Hidden objectives are evaluated normally but are never listed in the
     * objective panel and never surfaced in a preview.
     */
    hidden: Type.Boolean(),
    /**
     * An objective that is already complete stays complete unless its rule
     * declares a maintained condition (only `defeat_or_rout` is maintained).
     */
    rule: RegisteredObjectiveRuleSchema,
  },
  { additionalProperties: false },
);

/**
 * One authored objective. `kind` and `rule.kind` must agree — a definition
 * whose declared primitive and rule disagree is invalid content, not a
 * runtime fallback.
 */
export const ObjectiveDefinitionSchema = Type.Refine(
  ObjectiveDefinitionObjectSchema,
  (definition) => definition.kind === definition.rule.kind,
);

export type ObjectiveDefinition = Static<typeof ObjectiveDefinitionSchema>;

/**
 * The pinned encounter-level objective rules input. Travels inside
 * `CombatState` so replay never needs an external rules lookup.
 */
export const ObjectiveRulesSchema = Type.Object(
  {
    definitions: Type.Array(ObjectiveDefinitionSchema, {
      maxItems: COMBAT_OBJECTIVE_BOUNDS.definitions,
    }),
    /**
     * Optional protected-actor constraint. A protected actor that is defeated
     * at an evaluation boundary is a mandatory loss, whatever else succeeded.
     */
    protectedActorIds: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_OBJECTIVE_BOUNDS.protectedActors,
    }),
  },
  { additionalProperties: false },
);

export type ObjectiveRules = Static<typeof ObjectiveRulesSchema>;

/** Empty objective rules — a fight with no authored objectives. */
export const emptyObjectiveRules = (): ObjectiveRules => ({
  definitions: [],
  protectedActorIds: [],
});

/**
 * Observable objective progress. `progress` counts satisfied requirement
 * units for the objective's primitive (rounds survived, actors in zone,
 * hostiles routed, or 0/1 for a completed interaction).
 */
export const ObjectiveProgressSchema = Type.Object(
  {
    objectiveId: BoundedIdSchema,
    status: Type.Union([Type.Literal('pending'), Type.Literal('complete'), Type.Literal('failed')]),
    progress: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ObjectiveProgress = Static<typeof ObjectiveProgressSchema>;

/** Total order on strings — the deterministic tie-break for authored ids. */
export const compareCombatIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/** Total order on progress records — the stable settlement tie-break. */
export const compareObjectiveProgress = (a: ObjectiveProgress, b: ObjectiveProgress): number =>
  compareCombatIds(a.objectiveId, b.objectiveId);
