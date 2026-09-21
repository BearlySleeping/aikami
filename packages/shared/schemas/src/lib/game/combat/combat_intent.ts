// packages/shared/schemas/src/lib/game/combat/combat_intent.ts
//
// Natural-language combat intent envelope (Combat-05).
//
// The intent envelope expresses a DESIRE, never a resolution: selectors only
// ("nearest hostile", "somewhere safe", "strongest fire ability") and never an
// entity id, a coordinate, a dice value, an HP total or a hidden-entity
// reference. Semantic interpretation (an LLM, or the deterministic offline
// parser) fills this shape; the deterministic compiler in `@aikami/utils`
// grounds the selectors against the live `CombatState` and produces a
// `CompiledPlan` carrying an ordinary C-509 `CombatCommand` + `ActionForecast`.
//
// Every object is closed (`additionalProperties: false`) and every free-text
// field is capped by {@link COMBAT_INTENT_BOUNDS}: model output and player text
// are untrusted data (architecture §20).
//
// Contract: C-525 AC-1, AC-8

import Type from 'typebox';
import { DamageTypeKeySchema } from '../damage_type';
import { CombatCommandSchema } from './combat_command';
import { ActionForecastSchema, CombatPreviewWarningSchema } from './combat_preview';
import { GridPointSchema, RangeBandSchema } from './combat_state';

// ---------------------------------------------------------------------------
// Bounds — one place for every free-text / cardinality cap
// ---------------------------------------------------------------------------

/**
 * Hard caps for the intent envelope.
 *
 * `rawTextChars` bounds the untrusted player (or content-pack) string that may
 * ever reach a prompt; `steps`/`fallbackSteps`/`clarificationOptions` bound the
 * shape so a hostile or broken producer cannot make the UI loop forever.
 */
export const COMBAT_INTENT_BOUNDS = {
  /** Maximum length of verbatim player text kept on an intent or sent to a prompt. */
  rawTextChars: 400,
  /** Maximum steps in one `ActionIntent`. */
  steps: 2,
  /** Maximum steps in the deterministic fallback intent. */
  fallbackSteps: 2,
  /** Maximum concrete options in one clarification request. */
  clarificationOptions: 4,
  /** Maximum length of an `explicit` selector's free-text named reference. */
  namedRefChars: 64,
  /** Maximum length of a clarification question / option key. */
  clarificationKeyChars: 64,
  /** Maximum length of a client-minted intent id. */
  intentIdChars: 64,
  /** Maximum number of assumptions on a compiled plan. */
  assumptions: 4,
  /** Maximum length of one compiled-plan assumption. */
  assumptionChars: 160,
} as const;

// ---------------------------------------------------------------------------
// Selectors — semantic only, never ids
// ---------------------------------------------------------------------------

export const EntitySelectorSchema = Type.Union([
  Type.Object({ kind: Type.Literal('nearest_hostile') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('nearest_ally') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('last_attacker') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('previous_target') }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal('explicit'),
      /** Free text ("the goblin"); resolved deterministically or clarified. */
      namedRef: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.namedRefChars }),
    },
    { additionalProperties: false },
  ),
]);

export const RelativeDirectionSchema = Type.Union([
  Type.Literal('toward'),
  Type.Literal('away'),
  Type.Literal('behind'),
  Type.Literal('beside'),
]);

export const LocationSelectorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('relative'),
      relativeTo: EntitySelectorSchema,
      band: RangeBandSchema,
      direction: Type.Optional(RelativeDirectionSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('nearest_safe') }, { additionalProperties: false }),
]);

export const AbilitySelectorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('tag'),
      /** A capability tag — e.g. `basic_melee`, `ranged_attack`, `defend`. */
      value: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.namedRefChars }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('strongest'),
      damageType: Type.Optional(DamageTypeKeySchema),
    },
    { additionalProperties: false },
  ),
]);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const IntentStepSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('move'),
      destination: LocationSelectorSchema,
      stopAt: Type.Optional(RangeBandSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('use_ability'),
      ability: AbilitySelectorSchema,
      target: EntitySelectorSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('defend') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('wait') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('end_turn') }, { additionalProperties: false }),
  /**
   * Use one authored affordance on one authored battlefield object (C-531).
   *
   * Free text only: the object and the affordance are NAMED, never addressed by
   * id, coordinate, dice value or effect. The deterministic compiler grounds
   * both against the encounter's pinned registry and produces an ordinary
   * `interactWithObject` command plus its forecast — the same command the
   * manual object inspector sends.
   */
  Type.Object(
    {
      kind: Type.Literal('interact_with_object'),
      /** Free text naming the object, e.g. "the brazier". */
      object: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.namedRefChars }),
      /** Free text naming the action, e.g. "tip over". */
      affordance: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.namedRefChars }),
      /** Optional second object the approach names, e.g. "the oil". */
      targetObject: Type.Optional(
        Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.namedRefChars }),
      ),
    },
    { additionalProperties: false },
  ),
]);

export const IntentSourceSchema = Type.Union([
  Type.Literal('player_language'),
  Type.Literal('fallback_parser'),
  /** A model-authored AI combat decision (Combat-06). */
  Type.Literal('ai_decision'),
]);

export const ActionIntentSchema = Type.Object(
  {
    intentId: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.intentIdChars }),
    encounterId: Type.String({ minLength: 1 }),
    actorId: Type.String({ minLength: 1 }),
    /** The `CombatState.stateRevision` the language was interpreted against. */
    basedOnRevision: Type.Integer({ minimum: 0 }),
    source: IntentSourceSchema,
    steps: Type.Array(IntentStepSchema, {
      minItems: 1,
      maxItems: COMBAT_INTENT_BOUNDS.steps,
    }),
    fallback: Type.Optional(
      Type.Array(IntentStepSchema, { maxItems: COMBAT_INTENT_BOUNDS.fallbackSteps }),
    ),
    /**
     * Verbatim, bounded, untrusted player text. Kept for display/telemetry and
     * never concatenated into a privileged prompt as instructions.
     */
    rawText: Type.Optional(Type.String({ maxLength: COMBAT_INTENT_BOUNDS.rawTextChars })),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Trusted UI selections
// ---------------------------------------------------------------------------

/**
 * An exact cell the player clicked.
 *
 * Trusted UI input travels outside the model-facing `ActionIntent`: it is
 * validated against the live battlefield and ability grants, then grounded, so
 * pointer selections never pass through an interpreter.
 */
export const TrustedCellInputSchema = Type.Object(
  {
    kind: Type.Literal('cell'),
    cell: GridPointSchema,
  },
  { additionalProperties: false },
);

/** An exact ability the player picked from the catalog. */
export const TrustedAbilityInputSchema = Type.Object(
  {
    kind: Type.Literal('ability'),
    abilityId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Compiled plan
// ---------------------------------------------------------------------------

export const CompiledPlanSchema = Type.Object(
  {
    planId: Type.String({ minLength: 1 }),
    intentId: Type.String({ minLength: 1 }),
    encounterId: Type.String({ minLength: 1 }),
    actorId: Type.String({ minLength: 1 }),
    basedOnRevision: Type.Integer({ minimum: 0 }),
    /** Single-step in Combat-05 (architecture §25, decision 5). */
    command: CombatCommandSchema,
    forecast: ActionForecastSchema,
    assumptions: Type.Array(
      Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.assumptionChars }),
      {
        maxItems: COMBAT_INTENT_BOUNDS.assumptions,
      },
    ),
    warnings: Type.Array(CombatPreviewWarningSchema),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Clarification
// ---------------------------------------------------------------------------

export const ClarificationOptionSchema = Type.Object(
  {
    optionId: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.clarificationKeyChars }),
    /** i18n key — the compiler never authors prose. */
    labelKey: Type.String({ minLength: 1, maxLength: COMBAT_INTENT_BOUNDS.clarificationKeyChars }),
    steps: Type.Array(IntentStepSchema, { minItems: 1, maxItems: COMBAT_INTENT_BOUNDS.steps }),
  },
  { additionalProperties: false },
);

export const ClarificationRequestSchema = Type.Object(
  {
    /** i18n key for the question. */
    questionKey: Type.String({
      minLength: 1,
      maxLength: COMBAT_INTENT_BOUNDS.clarificationKeyChars,
    }),
    options: Type.Array(ClarificationOptionSchema, {
      minItems: 2,
      maxItems: COMBAT_INTENT_BOUNDS.clarificationOptions,
    }),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Interpreter result
// ---------------------------------------------------------------------------

/** Every reason a deterministic or model interpreter may decline with. */
export const IntentInterpreterFailureReasonSchema = Type.Union([
  Type.Literal('unparseable'),
  Type.Literal('unknown_capability'),
  Type.Literal('refused'),
]);

/** Every non-ambiguous failure reason, in canonical order. */
export const INTENT_INTERPRETER_FAILURE_REASONS = [
  'unparseable',
  'unknown_capability',
  'refused',
] as const;

// ---------------------------------------------------------------------------
// Interpreter draft — everything the model is allowed to author
// ---------------------------------------------------------------------------

/**
 * The ONLY shape an interpreter may fill in.
 *
 * The envelope identity (`intentId`, `encounterId`, `actorId`,
 * `basedOnRevision`, `source`) is minted by the client, never by the model: the
 * draft cannot express an id at all, so an injected "target emberwatch:goblin-1"
 * has nowhere to land (AC-8). A model that cannot read the instruction answers
 * with a typed refusal instead of inventing steps.
 */
export const CombatIntentDraftSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('intent'),
      steps: Type.Array(IntentStepSchema, {
        minItems: 1,
        maxItems: COMBAT_INTENT_BOUNDS.steps,
      }),
      fallback: Type.Optional(
        Type.Array(IntentStepSchema, { maxItems: COMBAT_INTENT_BOUNDS.fallbackSteps }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('refusal'),
      reason: IntentInterpreterFailureReasonSchema,
    },
    { additionalProperties: false },
  ),
]);

export const IntentInterpreterResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      intent: ActionIntentSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: IntentInterpreterFailureReasonSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Literal('ambiguous'),
      clarification: ClarificationRequestSchema,
    },
    { additionalProperties: false },
  ),
]);
