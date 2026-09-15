// packages/shared/schemas/src/lib/game/combat/combat_ai_decision.ts
//
// AI combat decision contract (Combat-06).
//
// The decision is the AI counterpart of the player's `ActionIntent`: it
// expresses a DESIRE (goal + C-525 selector-only steps) and never a mechanic.
// Two shapes exist, mirroring the C-525 split:
//
//   - `CombatDecisionContext` — the engine-built, perception-limited snapshot
//     the model may read. It carries ids because the MODEL must be able to name
//     what it perceives; it never carries hidden entities, secrets, raw ECS
//     state or unbounded history.
//   - `AiCombatDecisionDraft` — the ONLY shape a model may author. It has no
//     envelope identity, no ids, no coordinates, no dice and no HP, so an
//     injected instruction has nowhere to land.
//
// The envelope identity (`decisionId` / `encounterId` / `actorId` /
// `basedOnRevision`) is minted by the client from the caller's request.
// Every object is closed (`additionalProperties: false`) and every free-text
// field is capped by {@link COMBAT_AI_BOUNDS} (architecture §20).
//
// Contract: C-526 AC-1, AC-3, AC-6, AC-7, AC-11

import Type, { type Static } from 'typebox';
import { COMBAT_ENVIRONMENT_BOUNDS } from './combat_environment';
import { IntentStepSchema } from './combat_intent';
import {
  CombatActionCostSchema,
  CombatObjectiveStatusSchema,
  GridPointSchema,
  RangeBandSchema,
} from './combat_state';

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Hard caps for the AI decision and narration contracts.
 *
 * The perception snapshot is bounded BY CONSTRUCTION: every array has a
 * `maxItems` and the caller asserts the serialized size against
 * `tokenBudget` (default {@link COMBAT_AI_TOKEN_BUDGET}).
 */
export const COMBAT_AI_BOUNDS = {
  /** Maximum length of a client-minted decision id. */
  decisionIdChars: 64,
  /** Maximum length of an authored goal id/label. */
  goalChars: 64,
  /** Maximum length of `shortReason` — trace only, never chain-of-thought. */
  shortReasonChars: 160,
  /** Maximum length of the bounded `proposedLine` telegraph. */
  proposedLineChars: 160,
  /** Maximum steps in an AI decision intent (reuses the C-525 step vocabulary). */
  steps: 2,
  /** Maximum steps in an AI decision fallback intent. */
  fallbackSteps: 2,
  /** Maximum bounded personality traits on the actor. */
  personalityTraits: 4,
  /** Maximum length of one personality trait / fear / condition string. */
  traitChars: 48,
  /** Maximum relationships the actor may hold in one snapshot. */
  relationships: 8,
  /** Maximum fears the actor may hold in one snapshot. */
  fears: 4,
  /** Maximum length of the free-text relationship note. */
  relationshipNoteChars: 80,
  /** Maximum length of the actor's emotional state label. */
  emotionalStateChars: 48,
  /** Maximum objectives surfaced from kernel state. */
  objectives: 8,
  /** Maximum visible combatants in one snapshot. */
  visibleCombatants: 12,
  /** Maximum PERCEIVED battlefield objects in one snapshot (C-531). */
  visibleObjects: 12,
  /** Maximum available affordances surfaced per perceived object (C-531). */
  objectAffordances: 6,
  /** Maximum conditions surfaced per visible combatant. */
  conditionsPerCombatant: 4,
  /** Maximum legal capabilities in one snapshot. */
  capabilities: 16,
  /** Maximum reachable targets in one snapshot. */
  reachableTargets: 12,
  /** Maximum candidate positions in one snapshot. */
  candidatePositions: 8,
  /** Maximum length of one candidate-position band label. */
  cellBandChars: 32,
  /** Maximum imminent threats in one snapshot. */
  imminentThreats: 6,
  /** Maximum length of one imminent threat string. */
  threatChars: 96,
  /** Maximum recent events in one snapshot. */
  recentEvents: 6,
  /** Maximum length of one recent-event summary. */
  recentEventSummaryChars: 120,
  /** Maximum length of one recent-event kind label. */
  recentEventKindChars: 32,
  /** Maximum length of a model-authored narration block. */
  narrationTextChars: 600,
  /**
   * Maximum mechanical claims the narrator may reference.
   *
   * Claims are REFERENCES, not wording: each one is rendered deterministically
   * from the resolved event it points at, so the count bound is the only thing
   * the model can inflate.
   */
  narrationClaims: 8,
  /**
   * Maximum length of the mechanically inert flavour sentence.
   *
   * Deliberately much tighter than `narrationTextChars`: the flavour channel
   * carries no mechanics, so it earns no room.
   */
  narrationFlavorChars: 240,
  /** Highest fact index a claim may reference (a hard, schema-level bound). */
  narrationFactIndexMax: 63,
  /**
   * Maximum length of a companion's standing goal (Intent mode, §12.5).
   *
   * Bounded because it is player-authored text injected into a prompt
   * (`combat_2.md` §20: player text is untrusted data).
   */
  standingGoalChars: 120,
  /** Maximum length of a role / class label. */
  roleChars: 48,
  /** Maximum length of a combat-role note. */
  stanceNoteChars: 80,
} as const;

/** Default perception-snapshot token budget (architecture §18). */
export const COMBAT_AI_TOKEN_BUDGET = 800;

/** Approximate characters-per-token used by the snapshot size assertion. */
export const COMBAT_AI_CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** How confident the decision producer was in its plan. */
export const CombatAiConfidenceSchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
]);

export type CombatAiConfidence = Static<typeof CombatAiConfidenceSchema>;

/** Actor relationship stance toward another combatant. */
export const CombatRelationshipStanceSchema = Type.Union([
  Type.Literal('friendly'),
  Type.Literal('neutral'),
  Type.Literal('hostile'),
]);

export type CombatRelationshipStance = Static<typeof CombatRelationshipStanceSchema>;

/** Coarse health band — never a raw HP total (perception discipline). */
export const CombatHealthBandSchema = Type.Union([
  Type.Literal('healthy'),
  Type.Literal('bloodied'),
  Type.Literal('critical'),
]);

export type CombatHealthBand = Static<typeof CombatHealthBandSchema>;

/** How exposed a reachable target is. */
export const CombatCoverSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('partial'),
  Type.Literal('full'),
]);

export type CombatCover = Static<typeof CombatCoverSchema>;

/** Risk of a candidate position. */
export const CombatRiskSchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
]);

export type CombatRisk = Static<typeof CombatRiskSchema>;

/** Morale defaults to `steady` until Combat-08 authors thresholds. */
export const CombatMoraleSchema = Type.Union([
  Type.Literal('steady'),
  Type.Literal('shaken'),
  Type.Literal('wavering'),
  Type.Literal('broken'),
]);

export type CombatMorale = Static<typeof CombatMoraleSchema>;

/** How much risk the actor accepts. */
export const CombatRiskToleranceSchema = Type.Union([
  Type.Literal('cautious'),
  Type.Literal('balanced'),
  Type.Literal('bold'),
]);

export type CombatRiskTolerance = Static<typeof CombatRiskToleranceSchema>;

/** Whether the actor follows orders or its own judgment. */
export const CombatObedienceSchema = Type.Union([
  Type.Literal('obedient'),
  Type.Literal('independent'),
]);

export type CombatObedience = Static<typeof CombatObedienceSchema>;

/** Encounter difficulty policy — a context field, never a reasoning throttle. */
export const CombatDifficultySchema = Type.Union([
  Type.Literal('easy'),
  Type.Literal('normal'),
  Type.Literal('hard'),
]);

export type CombatDifficulty = Static<typeof CombatDifficultySchema>;

/** Every degradation reason, in canonical order. */
export const COMBAT_AI_DEGRADED_REASONS = [
  'offline',
  'timeout',
  'invalid',
  'stale',
  'disabled',
  'cancelled',
] as const;

type LiteralTupleOf<T extends readonly string[]> = T extends readonly [
  infer First extends string,
  ...infer Rest extends string[],
]
  ? [ReturnType<typeof Type.Literal<First>>, ...LiteralTupleOf<Rest>]
  : [];

const combatAiDegradedReasonSchemas = COMBAT_AI_DEGRADED_REASONS.map((reason) =>
  Type.Literal(reason),
) as LiteralTupleOf<typeof COMBAT_AI_DEGRADED_REASONS>;

/** Why the AI fell back to the deterministic path. */
export const CombatAiDegradedReasonSchema = Type.Union(combatAiDegradedReasonSchemas);

export type CombatAiDegradedReason = Static<typeof CombatAiDegradedReasonSchema>;

/** Where a decision / narration came from. */
export const CombatAiSourceSchema = Type.Union([Type.Literal('llm'), Type.Literal('fallback')]);

export type CombatAiSource = Static<typeof CombatAiSourceSchema>;

/** Where narration text came from. */
export const CombatNarrationSourceSchema = Type.Union([
  Type.Literal('llm'),
  Type.Literal('template'),
]);

export type CombatNarrationSource = Static<typeof CombatNarrationSourceSchema>;

/**
 * Companion control mode (persisted player preference).
 *
 * Default `suggest` for the first release (`combat_2.md` §25 decision 6).
 */
export const CompanionControlModeSchema = Type.Union([
  Type.Literal('direct'),
  Type.Literal('suggest'),
  Type.Literal('intent'),
  Type.Literal('autonomous'),
]);

export type CompanionControlMode = Static<typeof CompanionControlModeSchema>;

/** Default companion control mode for new and legacy party entries. */
export const DEFAULT_COMPANION_CONTROL_MODE: CompanionControlMode = 'suggest';

// ---------------------------------------------------------------------------
// AiCombatDecision — engine-facing envelope (selectors only)
// ---------------------------------------------------------------------------

export const AiCombatDecisionSchema = Type.Object(
  {
    decisionId: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.decisionIdChars }),
    encounterId: Type.String({ minLength: 1 }),
    actorId: Type.String({ minLength: 1 }),
    /** The `CombatState.stateRevision` the decision was produced against. */
    basedOnRevision: Type.Integer({ minimum: 0 }),
    /** Authored goal id/label — bounded, presentation-safe. */
    goal: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.goalChars }),
    /** C-525 selectors — no ids, coordinates, dice or HP. */
    intent: Type.Array(IntentStepSchema, {
      minItems: 1,
      maxItems: COMBAT_AI_BOUNDS.steps,
    }),
    fallback: Type.Array(IntentStepSchema, { maxItems: COMBAT_AI_BOUNDS.fallbackSteps }),
    confidence: CombatAiConfidenceSchema,
    /** Trace only; never chain-of-thought. */
    shortReason: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.shortReasonChars })),
    /** Bounded telegraph text — the attempt narration. */
    proposedLine: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.proposedLineChars })),
  },
  { additionalProperties: false },
);

export type AiCombatDecision = Static<typeof AiCombatDecisionSchema>;

// ---------------------------------------------------------------------------
// AiCombatDecisionDraft — the ONLY shape a model may author
// ---------------------------------------------------------------------------

/**
 * The only shape an AI decision model may fill in.
 *
 * There is no `decisionId` / `encounterId` / `actorId` / `basedOnRevision`
 * field and `IntentStep` cannot express an id, a coordinate, a dice value or
 * an HP total — an injected "attack emberwatch:goblin-1" has nowhere to land
 * (AC-1).
 */
export const AiCombatDecisionDraftSchema = Type.Object(
  {
    goal: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.goalChars }),
    intent: Type.Array(IntentStepSchema, {
      minItems: 1,
      maxItems: COMBAT_AI_BOUNDS.steps,
    }),
    fallback: Type.Array(IntentStepSchema, { maxItems: COMBAT_AI_BOUNDS.fallbackSteps }),
    confidence: CombatAiConfidenceSchema,
    shortReason: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.shortReasonChars })),
    proposedLine: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.proposedLineChars })),
  },
  { additionalProperties: false },
);

export type AiCombatDecisionDraft = Static<typeof AiCombatDecisionDraftSchema>;

/**
 * A squad-batched decision response: one draft per actor, in one model call.
 *
 * Same-squad enemies are planned together (AC-5) while still producing a
 * separate validated decision per actor, so batching never merges turns.
 */
export const AiCombatDecisionBatchDraftSchema = Type.Object(
  {
    decisions: Type.Record(
      Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.decisionIdChars }),
      AiCombatDecisionDraftSchema,
      {
        propertyNames: Type.String({
          minLength: 1,
          maxLength: COMBAT_AI_BOUNDS.decisionIdChars,
        }),
        maxProperties: COMBAT_AI_BOUNDS.visibleCombatants,
      },
    ),
  },
  { additionalProperties: false },
);

export type AiCombatDecisionBatchDraft = Static<typeof AiCombatDecisionBatchDraftSchema>;

// ---------------------------------------------------------------------------
// CombatDecisionContext — perception-limited snapshot
// ---------------------------------------------------------------------------

export const CombatActorContextSchema = Type.Object(
  {
    combatantId: Type.String({ minLength: 1 }),
    /** Combat role / class label. */
    role: Type.String({ maxLength: COMBAT_AI_BOUNDS.roleChars }),
    /** Bounded character traits — drives personality, never legality. */
    personality: Type.Array(Type.String({ maxLength: COMBAT_AI_BOUNDS.traitChars }), {
      maxItems: COMBAT_AI_BOUNDS.personalityTraits,
    }),
    relationships: Type.Array(
      Type.Object(
        {
          combatantId: Type.String({ minLength: 1 }),
          stance: CombatRelationshipStanceSchema,
          note: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.relationshipNoteChars })),
        },
        { additionalProperties: false },
      ),
      { maxItems: COMBAT_AI_BOUNDS.relationships },
    ),
    fears: Type.Array(Type.String({ maxLength: COMBAT_AI_BOUNDS.traitChars }), {
      maxItems: COMBAT_AI_BOUNDS.fears,
    }),
    emotionalState: Type.String({ maxLength: COMBAT_AI_BOUNDS.emotionalStateChars }),
    /**
     * Player-authored standing goal (C-526 §12.5, Intent mode).
     *
     * Present only for a companion whose player set an Intent goal. It is
     * DIRECTION, not mechanics: the model may pursue it, and the kernel still
     * validates every resulting command. Absent for every other actor, so old
     * callers keep compiling unchanged.
     */
    standingGoal: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.standingGoalChars })),
  },
  { additionalProperties: false },
);

export type CombatActorContext = Static<typeof CombatActorContextSchema>;

export const CombatObjectiveContextSchema = Type.Object(
  {
    objectiveId: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 }),
    status: CombatObjectiveStatusSchema,
  },
  { additionalProperties: false },
);

export type CombatObjectiveContext = Static<typeof CombatObjectiveContextSchema>;

export const VisibleCombatantContextSchema = Type.Object(
  {
    combatantId: Type.String({ minLength: 1 }),
    team: Type.Union([
      Type.Literal('player'),
      Type.Literal('ally'),
      Type.Literal('enemy'),
      Type.Literal('neutral'),
    ]),
    /** Coarse band — never a raw HP total. */
    healthBand: CombatHealthBandSchema,
    conditions: Type.Array(Type.String({ maxLength: COMBAT_AI_BOUNDS.traitChars }), {
      maxItems: COMBAT_AI_BOUNDS.conditionsPerCombatant,
    }),
    /** Last perceived cell; omitted when the actor has never seen the target. */
    lastKnown: Type.Optional(GridPointSchema),
  },
  { additionalProperties: false },
);

export type VisibleCombatantContext = Static<typeof VisibleCombatantContextSchema>;

export const CapabilityContextSchema = Type.Object(
  {
    abilityId: Type.String({ minLength: 1 }),
    rangeBand: RangeBandSchema,
    requiresLineOfSight: Type.Boolean(),
    available: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type CapabilityContext = Static<typeof CapabilityContextSchema>;

export const ReachableTargetContextSchema = Type.Object(
  {
    combatantId: Type.String({ minLength: 1 }),
    distanceBand: RangeBandSchema,
    cover: CombatCoverSchema,
  },
  { additionalProperties: false },
);

export type ReachableTargetContext = Static<typeof ReachableTargetContextSchema>;

export const CandidatePositionContextSchema = Type.Object(
  {
    /** Coarse band label ("north cover", "melee with nearest hostile"). */
    cellBand: Type.String({ maxLength: COMBAT_AI_BOUNDS.cellBandChars }),
    risk: CombatRiskSchema,
  },
  { additionalProperties: false },
);

export type CandidatePositionContext = Static<typeof CandidatePositionContextSchema>;

export const RecentEventContextSchema = Type.Object(
  {
    kind: Type.String({ maxLength: COMBAT_AI_BOUNDS.recentEventKindChars }),
    summary: Type.String({ maxLength: COMBAT_AI_BOUNDS.recentEventSummaryChars }),
  },
  { additionalProperties: false },
);

export type RecentEventContext = Static<typeof RecentEventContextSchema>;

/**
 * One PERCEIVED battlefield object (C-531).
 *
 * Only objects the actor can actually see appear here, and only the affordances
 * the actor can actually take are listed. `availableAffordances` is the
 * registry's own answer — the model never receives an action the kernel would
 * reject, and an unperceived object never enters the snapshot at all.
 */
export const VisibleObjectContextSchema = Type.Object(
  {
    objectId: Type.String({ minLength: 1, maxLength: COMBAT_ENVIRONMENT_BOUNDS.idChars }),
    name: Type.String({ minLength: 1, maxLength: COMBAT_ENVIRONMENT_BOUNDS.nameChars }),
    state: Type.String({ maxLength: COMBAT_AI_BOUNDS.cellBandChars }),
    cover: Type.String({ maxLength: COMBAT_AI_BOUNDS.cellBandChars }),
    ignited: Type.Boolean(),
    availableAffordances: Type.Array(
      Type.Object(
        {
          affordanceId: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.cellBandChars }),
          name: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.cellBandChars }),
          actionCost: CombatActionCostSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: COMBAT_AI_BOUNDS.objectAffordances },
    ),
  },
  { additionalProperties: false },
);

export type VisibleObjectContext = Static<typeof VisibleObjectContextSchema>;

export const CombatDecisionContextSchema = Type.Object(
  {
    actor: CombatActorContextSchema,
    objectives: Type.Array(CombatObjectiveContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.objectives,
    }),
    visibleCombatants: Type.Array(VisibleCombatantContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.visibleCombatants,
    }),
    /** C-531: only PERCEIVED objects, each with only its USABLE affordances. */
    visibleObjects: Type.Array(VisibleObjectContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.visibleObjects,
    }),
    capabilities: Type.Array(CapabilityContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.capabilities,
    }),
    reachableTargets: Type.Array(ReachableTargetContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.reachableTargets,
    }),
    candidatePositions: Type.Array(CandidatePositionContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.candidatePositions,
    }),
    imminentThreats: Type.Array(Type.String({ maxLength: COMBAT_AI_BOUNDS.threatChars }), {
      maxItems: COMBAT_AI_BOUNDS.imminentThreats,
    }),
    morale: CombatMoraleSchema,
    riskTolerance: CombatRiskToleranceSchema,
    obedience: CombatObedienceSchema,
    difficulty: CombatDifficultySchema,
    recentEvents: Type.Array(RecentEventContextSchema, {
      maxItems: COMBAT_AI_BOUNDS.recentEvents,
    }),
    tokenBudget: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type CombatDecisionContext = Static<typeof CombatDecisionContextSchema>;

// ---------------------------------------------------------------------------
// CombatAiDecisionRecord — telemetry / replay (§17)
// ---------------------------------------------------------------------------

export const CombatAiDecisionRecordSchema = Type.Object(
  {
    decisionId: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.decisionIdChars }),
    encounterId: Type.String({ minLength: 1 }),
    actorId: Type.String({ minLength: 1 }),
    basedOnRevision: Type.Integer({ minimum: 0 }),
    source: CombatAiSourceSchema,
    provider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    latencyMs: Type.Integer({ minimum: 0 }),
    fallbackReason: Type.Optional(CombatAiDegradedReasonSchema),
    goal: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.goalChars })),
    confidence: Type.Optional(CombatAiConfidenceSchema),
    /** Concise — no secrets, no chain-of-thought. */
    rationale: Type.Optional(Type.String({ maxLength: COMBAT_AI_BOUNDS.shortReasonChars })),
  },
  { additionalProperties: false },
);

export type CombatAiDecisionRecord = Static<typeof CombatAiDecisionRecordSchema>;

// ---------------------------------------------------------------------------
// CombatNarrationResult — client-facing narration
// ---------------------------------------------------------------------------

export const CombatNarrationResultSchema = Type.Object(
  {
    narrationId: Type.String({ minLength: 1, maxLength: COMBAT_AI_BOUNDS.decisionIdChars }),
    encounterId: Type.String({ minLength: 1 }),
    basedOnRevision: Type.Integer({ minimum: 0 }),
    source: CombatNarrationSourceSchema,
    /** Bounded prose — no mechanics absent from the resolved events. */
    text: Type.String({ maxLength: COMBAT_AI_BOUNDS.narrationTextChars }),
  },
  { additionalProperties: false },
);

export type CombatNarrationResult = Static<typeof CombatNarrationResultSchema>;

/**
 * One mechanical claim the narrator may make, as a REFERENCE to a resolved fact.
 *
 * The model never authors the wording of a mechanical claim. It points at the
 * kind and position of the fact it wants narrated, and the deterministic
 * renderer produces the sentence. An unresolvable reference is rejected and the
 * authored template is used.
 *
 * This is what makes the facts-only guarantee structural rather than lexical:
 * "defeat must not authorise a victory sentence" and "one actor's defeat must
 * not authorise another actor's death" are impossible by construction, because
 * there is no field in which a model could write either sentence.
 */
const factRefProperties = {
  index: Type.Integer({
    minimum: 0,
    maximum: COMBAT_AI_BOUNDS.narrationFactIndexMax,
    description: "Position within that kind's fact list, in event order",
  }),
};

export const NarrationFactRefSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('attack'), ...factRefProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('damage'), ...factRefProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('movement'), ...factRefProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('downed'), ...factRefProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('defeated'), ...factRefProperties },
    { additionalProperties: false },
  ),
  /** The encounter outcome. Renders the authored victory OR defeat template. */
  Type.Object({ kind: Type.Literal('ended') }, { additionalProperties: false }),
]);

export type NarrationFactRef = Static<typeof NarrationFactRefSchema>;

/**
 * The only shape the narrator may author.
 *
 * `claims` carries every mechanical assertion, each one a reference the kernel
 * can resolve. `flavor` is an optional evocative sentence that must stay
 * mechanically inert — it may not name a combatant, carry a numeral, or use
 * outcome vocabulary. There is no field for HP, coordinates, conditions, dice
 * or arbitrary outcomes.
 */
export const CombatNarrationDraftSchema = Type.Object(
  {
    claims: Type.Array(NarrationFactRefSchema, {
      maxItems: COMBAT_AI_BOUNDS.narrationClaims,
      uniqueItems: true,
      default: [],
    }),
    flavor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: COMBAT_AI_BOUNDS.narrationFlavorChars,
      }),
    ),
  },
  { additionalProperties: false },
);

export type CombatNarrationDraft = Static<typeof CombatNarrationDraftSchema>;

// ---------------------------------------------------------------------------
// Size assertion helper (AC-2)
// ---------------------------------------------------------------------------

/**
 * Whether a serialized decision context fits its `tokenBudget`.
 *
 * The perception builder is bounded by construction; this is the belt-and-
 * braces assertion the caller runs so a future field addition cannot silently
 * blow the prompt budget (AC-2).
 */
export const fitsCombatDecisionTokenBudget = (options: {
  context: CombatDecisionContext;
  tokenBudget?: number;
}): boolean => {
  const budget = options.tokenBudget ?? options.context.tokenBudget;
  return JSON.stringify(options.context).length <= budget * COMBAT_AI_CHARS_PER_TOKEN;
};
