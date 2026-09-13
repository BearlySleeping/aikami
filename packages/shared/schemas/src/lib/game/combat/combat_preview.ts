// packages/shared/schemas/src/lib/game/combat/combat_preview.ts
//
// Tactical query + preview wire contract (Combat-03).
//
// A preview is a *pure question*: the client mints a `requestId`, binds the
// query to a `basedOnRevision`, and the engine answers with either a forecast
// or a typed rejection. Nothing here mutates state and nothing here is
// persisted.
//
// Deliberately camelCase literals: the C-509 wire vocabulary already uses
// `useAbility` / `endTurn` / `targetNotVisible`.
//
// Contract: C-515 AC-3, AC-4, AC-5

import Type, { type Static } from 'typebox';
import { CombatCommandSchema } from './combat_command';
import { CombatActionCostSchema, GridPointSchema, TurnBudgetSchema } from './combat_state';
import { CombatInvalidReasonSchema } from './combat_validation';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every cell the active combatant can legally end its movement on. */
export const LegalMoveQuerySchema = Type.Object(
  {
    kind: Type.Literal('legalMoves'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type LegalMoveQuery = Static<typeof LegalMoveQuerySchema>;

/** Every cell holding a combatant the ability may legally target. */
export const LegalTargetQuerySchema = Type.Object(
  {
    kind: Type.Literal('legalTargets'),
    combatantId: Type.String({ minLength: 1 }),
    abilityId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type LegalTargetQuery = Static<typeof LegalTargetQuerySchema>;

/** Forecast one concrete proposed command without committing it. */
export const ActionQuerySchema = Type.Object(
  {
    kind: Type.Literal('action'),
    combatantId: Type.String({ minLength: 1 }),
    command: CombatCommandSchema,
  },
  { additionalProperties: false },
);

export type ActionQuery = Static<typeof ActionQuerySchema>;

export const CombatPreviewQuerySchema = Type.Union([
  LegalMoveQuerySchema,
  LegalTargetQuerySchema,
  ActionQuerySchema,
]);

export type CombatPreviewQuery = Static<typeof CombatPreviewQuerySchema>;

export const CombatPreviewRequestSchema = Type.Object(
  {
    /** Client-minted correlation id; never reused across revisions. */
    requestId: Type.String({ minLength: 1 }),
    encounterId: Type.String({ minLength: 1 }),
    /** The C-509 `stateRevision` this query is bound to. */
    basedOnRevision: Type.Integer({ minimum: 0 }),
    query: CombatPreviewQuerySchema,
  },
  { additionalProperties: false },
);

export type CombatPreviewRequest = Static<typeof CombatPreviewRequestSchema>;

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

/**
 * Advisory warnings attached to a forecast.
 *
 * `triggersReaction` is reserved for Combat-08 and is never produced in
 * Combat-03.
 */
export const CombatPreviewWarningSchema = Type.Union([
  Type.Literal('triggersReaction'),
  Type.Literal('affectsAlly'),
  Type.Literal('consumesResource'),
  Type.Literal('endsTurn'),
]);

export type CombatPreviewWarning = Static<typeof CombatPreviewWarningSchema>;

/**
 * Deterministic, non-mutating projection of one proposed action.
 *
 * `reactionRisks` / `objectiveEffects` are `Type.Array(Type.Never())` — they
 * validate only `[]` today, and Combat-08 can widen the element type without
 * changing the object shape.
 */
export const ActionForecastSchema = Type.Object(
  {
    /** Recomputed movement path (move commands only). */
    path: Type.Optional(Type.Array(GridPointSchema)),
    /** Total movement cost of `path`, in cells. */
    movementCost: Type.Optional(Type.Integer({ minimum: 0 })),
    actionCost: Type.Union([Type.Literal('movement'), CombatActionCostSchema]),
    /** 0..1 advisory hit chance — never a dice result. */
    hitChance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    damageRange: Type.Optional(
      Type.Object(
        {
          minimum: Type.Integer({ minimum: 0 }),
          maximum: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    affectedCells: Type.Optional(Type.Array(GridPointSchema)),
    affectedEntityIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /** Reserved — Combat-08. */
    reactionRisks: Type.Array(Type.Never()),
    /** Reserved — Combat-08. */
    objectiveEffects: Type.Array(Type.Never()),
    warnings: Type.Array(CombatPreviewWarningSchema),
  },
  { additionalProperties: false },
);

export type ActionForecast = Static<typeof ActionForecastSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** The pure query module's answer for `legalMoves`. */
export const LegalActionsSchema = Type.Object(
  {
    endpoints: Type.Array(GridPointSchema),
    targetsByAbility: Type.Record(Type.String(), Type.Array(Type.String({ minLength: 1 }))),
    budget: TurnBudgetSchema,
  },
  { additionalProperties: false },
);

export type LegalActions = Static<typeof LegalActionsSchema>;

export const CombatPreviewSuccessSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    valid: Type.Literal(true),
    forecast: ActionForecastSchema,
    /** Present for `legalMoves`. */
    legalEndpoints: Type.Optional(Type.Array(GridPointSchema)),
    /** Present for `legalTargets`. */
    legalTargetIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /** Reserved for the UI grid; keys are `"x,y"`. */
    movementCostTo: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
  },
  { additionalProperties: false },
);

export type CombatPreviewSuccess = Static<typeof CombatPreviewSuccessSchema>;

export const CombatPreviewFailureSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    valid: Type.Literal(false),
    reasonCode: CombatInvalidReasonSchema,
    messageKey: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatPreviewFailure = Static<typeof CombatPreviewFailureSchema>;

export const CombatPreviewResultSchema = Type.Union([
  CombatPreviewSuccessSchema,
  CombatPreviewFailureSchema,
]);

export type CombatPreviewResult = Static<typeof CombatPreviewResultSchema>;
