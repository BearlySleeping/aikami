// packages/frontend/ai-gateway/src/lib/decision/types.ts
//
// Provider-neutral decision-contract types (issue #381, contract C-566).
//
// Nothing in this file names a vendor. The `/v1/systemone` wire shape lives in
// `dialect.ts` and is reachable only from an adapter, so a business schema can
// never grow a dependency on one runtime's DTOs.

/** Stable, machine-readable reasons a schema cannot become a decision plan. */
export const DECISION_INCOMPATIBILITY_CODES = [
  // ---- structural: the schema itself ----
  'unsupported-root-kind',
  'unsupported-property-type',
  'unsupported-array',
  'open-record',
  'optional-field',
  'nullable-field',
  'unsupported-constraint',
  'conditional-schema',
  'unsupported-primitive',
  'external-reference',
  'circular-reference',
  'unsafe-property-name',
  'mixed-choice-types',
  'empty-choice',
  // ---- size / bound guards ----
  'depth-limit-exceeded',
  'question-limit-exceeded',
  'option-limit-exceeded',
  'union-branch-limit-exceeded',
  'combination-limit-exceeded',
  // ---- semantic: the task, not the schema ----
  'semantic-opt-in-required',
  'missing-task-instructions',
  'missing-field-instructions',
  'opaque-field-name',
  'missing-option-descriptions',
  'unsupported-language',
  'correlated-fields-unsupported',
  'invalid-boolean-policy',
] as const;

/** One stable incompatibility code. */
export type DecisionIncompatibilityCode = (typeof DECISION_INCOMPATIBILITY_CODES)[number];

/**
 * One reason a schema could not be compiled, addressed to the exact location
 * that blocked it.
 *
 * `path` is an array of property segments rather than a dotted string so a
 * property literally named `a.b` cannot be confused with a nested path, and so
 * reconstruction never has to re-parse a string it did not build.
 */
export type DecisionIncompatibility = {
  /** Stable code for programmatic handling and test assertions. */
  readonly code: DecisionIncompatibilityCode;
  /** Property path from the schema root; empty array for root-level reasons. */
  readonly path: readonly string[];
  /** Human-readable detail. Never contains model output or player content. */
  readonly detail: string;
};

/** Hard structural limits. Every one is a bound, never a hint. */
export type DecisionLimits = {
  /** Maximum nested object depth. */
  readonly maxDepth: number;
  /** Maximum total questions in one plan. */
  readonly maxQuestions: number;
  /** Maximum options in a single choice question. */
  readonly maxOptions: number;
  /** Maximum `anyOf`/`oneOf` branches examined at one node. */
  readonly maxUnionBranches: number;
  /** Maximum legal combinations a correlated expansion may produce. */
  readonly maxCombinations: number;
  /** Maximum UTF-8 bytes of assembled context accepted before dispatch. */
  readonly maxContextBytes: number;
};

/** Conservative defaults. A caller may raise them explicitly; the compiler never does. */
export const DEFAULT_DECISION_LIMITS: DecisionLimits = {
  maxDepth: 4,
  maxQuestions: 16,
  maxOptions: 64,
  maxUnionBranches: 64,
  maxCombinations: 32,
  maxContextBytes: 48_000,
};

/** The literal values a decision primitive may take. */
export type DecisionLiteral = string | number | boolean;

/** How one field is asked. `combination` is a choice whose options are legal field tuples. */
export type DecisionQuestionKind = 'boolean' | 'choice' | 'combination';

/** One answerable option of a choice question. */
export type DecisionOption = {
  /** Wire-safe key handed to the backend. Never the literal itself. */
  readonly key: string;
  /** The exact literal to restore during reconstruction. */
  readonly value: DecisionLiteral;
  /** Author-written description. Present only after policy binding. */
  readonly description?: string;
};

/**
 * One legal combination of correlated fields, offered as a single option.
 *
 * This is how a correlated pair avoids producing an illegal answer: instead of
 * asking `action` and `target` independently — which permits `heal`/`enemy` —
 * the analyzer expands the legal tuples once and asks for one of them.
 */
export type DecisionCombinationOption = {
  /** Wire-safe key handed to the backend. */
  readonly key: string;
  /** Author-written rendering of the tuple, assembled from option descriptions. */
  readonly label: string;
  /** The exact literals to restore, one entry per correlated path. */
  readonly values: readonly { readonly path: readonly string[]; readonly value: DecisionLiteral }[];
};

/** A single question the backend is asked. */
export type DecisionQuestion = {
  /** Wire-safe unique key within the plan. Stable across property order. */
  readonly key: string;
  /** Property path from the schema root. */
  readonly path: readonly string[];
  /** How this field is answered. */
  readonly kind: DecisionQuestionKind;
  /** Schema-authored description of this field, when the schema carries one. */
  readonly description?: string;
  /** Meaningful question text. Only set once policy binding has run. */
  readonly instructions?: string;
  /** Options for `choice` questions. */
  readonly options?: readonly DecisionOption[];
  /** Options for `combination` questions. */
  readonly combinationOptions?: readonly DecisionCombinationOption[];
  /** Group this question is dispatched with. Defaults to `independent`. */
  readonly groupId: string;
};

/** A value the schema pins, so no inference is ever asked for it. */
export type DecisionConstant = {
  /** Property path from the schema root. */
  readonly path: readonly string[];
  /** The exact literal the schema requires. */
  readonly value: DecisionLiteral;
};

/** How a group of questions may be dispatched. */
export type DecisionGroupDispatch = 'independent' | 'staged' | 'combination';

/** A dispatchable unit of questions. */
export type DecisionQuestionGroup = {
  /** Group id referenced by {@link DecisionQuestion.groupId}. */
  readonly id: string;
  /** Question keys in this group, in stable path order. */
  readonly questionKeys: readonly string[];
  /**
   * `independent` — safe to dispatch in parallel with every other group.
   * `staged` — one deadline, dispatched as a unit; later keys may depend on
   * earlier answers. `combination` — already expanded into legal combinations
   * by the analyzer; the group is a a single choice question.
   */
  readonly dispatch: DecisionGroupDispatch;
};

/**
 * A compiled, backend-neutral decision plan.
 *
 * A plan is a *structural* artifact: it knows what may be asked and what the
 * exact answer values are, but it carries no question text until
 * `bindDecisionPolicy` supplies it. That separation is the whole point — a
 * schema can be perfectly compatible and still be a task we refuse to send to a
 * decision model.
 */
export type DecisionPlan = {
  /** Compiler version. Part of the cache key, so a bump invalidates plans. */
  readonly compilerVersion: string;
  /** Schema content fingerprint this plan was compiled from. */
  readonly schemaFingerprint: string;
  /** Questions, in stable path order. Independent of property declaration order. */
  readonly questions: readonly DecisionQuestion[];
  /** Schema-pinned literals, restored without inference. */
  readonly constants: readonly DecisionConstant[];
  /** Dispatch groups. Always present; a plan with no questions has none. */
  readonly groups: readonly DecisionQuestionGroup[];
};

/** Structural analysis outcome. */
export type DecisionAnalysis =
  | { readonly ok: true; readonly plan: DecisionPlan }
  | { readonly ok: false; readonly reasons: readonly DecisionIncompatibility[] };

/** Languages a decision checkpoint may declare. */
export const DECISION_LANGUAGES = ['en', 'multi'] as const;

/** A language tag a decision backend may support. */
export type DecisionLanguage = (typeof DECISION_LANGUAGES)[number];

/** How a task's correlated fields must be handled. */
export type DecisionCorrelationMode = 'combination' | 'staged' | 'reject';

/** Declares that a set of paths must not be answered independently. */
export type DecisionCorrelation = {
  /** The correlated paths, e.g. `['action']` and `['target']`. */
  readonly paths: readonly (readonly string[])[];
  /** How the correlation is honoured. `reject` never emits a question. */
  readonly mode: DecisionCorrelationMode;
  /** Allowed value tuples, in `paths` order. Required for combination mode; staged is unsupported. */
  readonly legalTuples?: readonly (readonly DecisionLiteral[])[];
};

/**
 * Per-task opt-in and semantics.
 *
 * Structural compatibility is computed without this; this is the second,
 * separate gate. `enabled` is deliberately explicit — no shipping call site is
 * opted in by this contract, because this contract routes nothing.
 */
export type DecisionTaskPolicy = {
  /** Owning task, for telemetry and cache identity. */
  readonly task: string;
  /** Explicit semantic opt-in. Absent or `false` blocks the plan. */
  readonly enabled: boolean;
  /** Task-level instructions. Must be meaningful prose, not a field name. */
  readonly instructions?: string;
  /** Language the task's content is authored in. */
  readonly language?: DecisionLanguage;
  /** Instructions keyed by encoded path. See `encodePathKey`. */
  readonly fieldInstructions?: Readonly<Record<string, string>>;
  /** Option descriptions keyed by encoded path, then by the option's LITERAL VALUE. */
  readonly optionDescriptions?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Fields whose values must not vary independently. */
  readonly correlations?: readonly DecisionCorrelation[];
  /**
   * Per-task boolean acceptance policy.
   *
   * These are deliberately task metadata and never a global constant: the
   * probability that a *specific* answer is correct is task- and
   * field-specific, and a shared `0.5` is exactly the guess this replaces.
   */
  readonly booleanPolicy?: {
    /** Below this probability the answer is not accepted. */
    readonly acceptProbability: number;
    /** At or above this probability the answer is accepted outright. */
    readonly confidentProbability: number;
    /** Between the two: abstain, requesting an LLM fallback when configured. */
    readonly fallback: 'reject' | 'llm';
  };
  /** Limits overriding {@link DEFAULT_DECISION_LIMITS} for this task. */
  readonly limits?: Partial<DecisionLimits>;
};

/** Policy-binding outcome. */
export type DecisionBinding =
  | {
      readonly ok: true;
      readonly plan: DecisionPlan;
      readonly groups: readonly DecisionQuestionGroup[];
    }
  | { readonly ok: false; readonly reasons: readonly DecisionIncompatibility[] };

/** One backend answer, in plan terms. */
export type DecisionAnswer = {
  /** Question key from the plan. */
  readonly questionKey: string;
  /** Chosen option key, for `choice` questions. */
  readonly optionKey?: string;
  /** Answer for `boolean` questions. */
  readonly booleanValue?: boolean;
  /**
   * Raw per-option probabilities as reported by the backend.
   *
   * These are the model's own distribution. They are NOT the probability that
   * the answer is correct, and no threshold may treat them as such without a
   * calibration measured on this task.
   */
  readonly probabilities?: Readonly<Record<string, number>>;
  /** Backend's own reported confidence. Also not a correctness probability. */
  readonly confidence?: number;
};

/** Why a reconstruction failed. */
export type DecisionReconstructionFailure = {
  readonly code:
    | 'missing-answer'
    | 'unknown-question-key'
    | 'missing-option-key'
    | 'unknown-option-key'
    | 'ambiguous-answer'
    | 'schema-validation-failed'
    | 'unsafe-property-path'
    | 'probability-out-of-range';
  /** Question key the failure belongs to. */
  readonly questionKey?: string;
  readonly detail: string;
};

/** Reconstruction outcome. `value` is always re-validated against the original schema. */
export type DecisionReconstruction =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly failure: DecisionReconstructionFailure };

/** Why a decision call ended without a usable value. */
export type DecisionAbstentionReason =
  | 'disabled-by-policy'
  | 'backend-unavailable'
  | 'below-accept-threshold'
  | 'llm-fallback-required'
  | 'invalid-response'
  | 'schema-incompatible'
  | 'deadline-exceeded'
  | 'cancelled'
  | 'context-too-large'
  | 'language-unsupported'
  | 'unauthorized';

/** Timing breakdown for one decision call. */
export type DecisionTimings = {
  /** Time spent compiling or fetching a cached plan. */
  readonly planMs: number;
  /** Time spent queueing for the backend. */
  readonly queueMs: number;
  /** Time spent resident in the backend: prefill plus scoring. */
  readonly inferenceMs: number;
  /** Time spent validating and reconstructing. */
  readonly validateMs: number;
  /** Wall clock across the whole call. */
  readonly totalMs: number;
};

/**
 * What a decision backend can actually do.
 *
 * Advertised from the running process, never from documentation: a listening
 * socket is not readiness, and a dialect that parses is not a checkpoint that
 * answers.
 */
export type DecisionCapability = {
  /** Backend identity, e.g. `deterministic-baseline`. */
  readonly backendId: string;
  /** Wire dialect this backend speaks. */
  readonly dialect: string;
  /** Ready only after a sample inference has succeeded. */
  readonly ready: boolean;
  /** Why the backend is not ready, when it is not. */
  readonly notReadyReason?: string;
  /** Typed probe failure; prose classification is only a legacy fallback. */
  readonly notReadyState?:
    | 'unsupported-runtime'
    | 'model-missing'
    | 'capability-missing'
    | 'unreachable'
    | 'unauthorized'
    | 'deadline-exceeded'
    | 'cancelled';
  /** Question primitives this backend can answer. */
  readonly primitives: readonly DecisionQuestionKind[];
  /** Maximum options in one choice question. */
  readonly maxOptions: number;
  /** Maximum questions in one dispatch. */
  readonly maxQuestions: number;
  /** Maximum assembled context bytes. */
  readonly maxContextBytes: number;
  /** Languages this checkpoint declares. */
  readonly languages: readonly DecisionLanguage[];
  /** Checkpoint/model identity, pinned and reported verbatim. */
  readonly checkpoint?: string;
  /** Runtime identity, e.g. `ollama 0.35.0`. */
  readonly runtime?: string;
  /** Backend-reported resource identity, e.g. a GPU device id. */
  readonly resourceId?: string;
};

/** Where a decision value came from. Recorded separately from the value. */
export type DecisionProvenance = {
  readonly backendId: string;
  readonly dialect: string;
  readonly checkpoint?: string;
  readonly runtime?: string;
  readonly resourceId?: string;
  /** Whether the value was accepted or abstained on. */
  readonly outcome: 'accepted' | 'abstained';
  readonly abstentionReason?: DecisionAbstentionReason;
  readonly timings: DecisionTimings;
  /** Whether the plan came from cache. */
  readonly planCacheHit: boolean;
};

/** The outcome of one decision request. */
export type DecisionResult =
  | {
      readonly ok: true;
      readonly value: Record<string, unknown>;
      readonly answers: readonly DecisionAnswer[];
      readonly provenance: DecisionProvenance;
    }
  | {
      readonly ok: false;
      readonly abstained: true;
      readonly reason: DecisionAbstentionReason;
      readonly provenance: DecisionProvenance;
    };

/** One question as assembled for dispatch, after limits have been checked. */
export type DecisionDispatch = {
  /** Question key. */
  readonly key: string;
  /** Question text. */
  readonly instructions: string;
  /** Options, for `choice` and `combination` questions. */
  readonly options?: readonly DecisionOption[];
  /** Legal combinations, for `combination` questions. */
  readonly combinationOptions?: readonly DecisionCombinationOption[];
};

/** A dispatchable unit: one group plus the context it shares. */
export type DecisionDispatchUnit = {
  readonly groupId: string;
  readonly dispatch: DecisionGroupDispatch;
  readonly questions: readonly DecisionDispatch[];
  /** Assembled context for this unit. */
  readonly state: string;
  /** UTF-8 byte length of `state`. */
  readonly stateBytes: number;
};
