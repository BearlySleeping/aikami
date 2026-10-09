// packages/frontend/ai-gateway/src/lib/decision/index.ts
//
// Public API of the decision-contract module (issue #381, contract C-566).
//
// Import as `@aikami/frontend-ai-gateway/decision`. Nothing exported here is
// wired into a shipping call site: this contract delivers a compiler, contracts,
// an evaluation harness and a recommendation, and step E owns the gated
// integration.
//
// Intended order of use:
//
//   1. `analyzeDecisionSchema` — structural compatibility, no task knowledge.
//   2. `bindDecisionPolicy`    — semantic opt-in, instructions, correlation.
//   3. `buildDecisionDispatch` — bounds, before anything is sent.
//   4. `runDecision`           — thresholds, reconstruction, provenance.

export type { DeterministicRule, DeterministicRuleSet } from './adapters/deterministic_adapter.ts';
export { createDeterministicDecisionAdapter } from './adapters/deterministic_adapter.ts';
export type {
  LlamaCppAdapterOptions,
  LlamaCppBuildInfo,
  LlamaCppEndpoints,
  LlamaCppServerProps,
  LlamaCppTransport,
} from './adapters/llamacpp_adapter.ts';
export {
  createLlamaCppDecisionAdapter,
  LLAMACPP_DECISION_LIMITS,
  llamaCppBackendId,
  parseLlamaCppBuildInfo,
  parseServerProps,
  sameCheckpoint,
} from './adapters/llamacpp_adapter.ts';
export type {
  SystemOneAdapterOptions,
  SystemOneEndpoints,
  SystemOneTransport,
} from './adapters/systemone_adapter.ts';
export {
  createSystemOneDecisionAdapter,
  decisionBackendId,
  JEV_DECISION_LIMITS,
} from './adapters/systemone_adapter.ts';
export type {
  DecisionAdapter,
  DecisionAdapterDiagnostics,
  DecisionAdapterResponse,
  DecisionRequest,
} from './adapters/types.ts';
export {
  analyzeDecisionSchema,
  DECISION_COMPILER_VERSION,
  isUnsafeSegment,
} from './analyzer.ts';
export type {
  SystemOneAnswer,
  SystemOnePrimitive,
  SystemOneQuestion,
  SystemOneRequest,
  SystemOneResponse,
} from './dialect.ts';
export {
  parseSystemOneResponse,
  SYSTEM_ONE_DIALECT,
  SYSTEM_ONE_MAX_BODY_BYTES,
} from './dialect.ts';
export type { DecisionDispatchPlan, DecisionDispatchRefusal } from './dispatch.ts';
export { buildDecisionDispatch } from './dispatch.ts';
export type { DecisionPlanCache } from './plan_cache.ts';
export { createDecisionPlanCache } from './plan_cache.ts';

// ---------------------------------------------------------------------------
// The ONE metric implementation. `live_measurement` re-exports it; the
// evaluator CLI and the deterministic harness call it directly. There is no
// second scorer left to disagree with.
// ---------------------------------------------------------------------------

export type {
  CaseOutcome,
  DecisionValueComparator,
  EvaluationCase,
  EvaluationCaseKind,
  EvaluationLatencyGate,
  EvaluationQualityGate,
  EvaluationReport,
  EvaluationSliceMetrics,
  EvaluationTally,
  LatencyConditionMethod,
  LegacyEvaluationCase,
} from './metrics.ts';
export {
  assertCaseIntegrity,
  createEvaluationTally,
  defaultDecisionValueComparator,
  evaluateQualityGates,
  evaluateSplit,
  foldOutcome,
  MIN_REPETITIONS_FOR_PERCENTILE,
  median,
  percentile,
  scoreResult,
  summarizeTally,
  toEvaluationCase,
} from './metrics.ts';

// ---------------------------------------------------------------------------
// Runtime-kind probes. Wire parsing is runtime-neutral; readiness is not.
// ---------------------------------------------------------------------------

export type {
  DecisionRuntimeEndpoints,
  DecisionRuntimeKind,
  DecisionRuntimeProbeFailureState,
  DecisionRuntimeProbeOptions,
  DecisionRuntimeProbeResult,
} from './runtime_probe.ts';
export { DECISION_RUNTIME_KINDS, probeDecisionRuntime, runtimeLabel } from './runtime_probe.ts';

// ---------------------------------------------------------------------------
// Native llama.cpp: a DIFFERENT dialect, not a different deployment of the
// same one. Kept in its own section because the boolean wire contract differs
// (`answers[q].noul` is a probability, not a boolean) and because every limit
// here is per-checkpoint rather than per-dialect.
// ---------------------------------------------------------------------------

export type {
  CheckpointLimitSource,
  CheckpointLimits,
  CheckpointLimitViolation,
} from './checkpoint_limits.ts';
export {
  checkCheckpointLimits,
  checkpointFamily,
  limitsForCheckpoint,
  NATIVE_CHECKPOINT_LIMITS,
  UNKNOWN_CHECKPOINT_MAX_CHOICE_OPTIONS,
} from './checkpoint_limits.ts';
export type {
  NativeAnswer,
  NativeParsedBody,
  NativeQuestion,
  NativeRefusal,
  NativeRequest,
  NativeResponse,
  NativeUsage,
} from './native_llamacpp_dialect.ts';
export {
  distributionSumsToOne,
  NATIVE_LLAMACPP_DIALECT,
  NATIVE_LLAMACPP_MAX_REQUEST_BYTES,
  NATIVE_LLAMACPP_MIN_BUILD_COMMIT,
  NATIVE_LLAMACPP_UNSUPPORTED_PRIMITIVES,
  NATIVE_LLAMACPP_UPSTREAM_PR,
  nativeStatusRefusal,
  parseNativeResponse,
  readNativeChoice,
  readNativeErrorMessage,
  readNativeNoul,
} from './native_llamacpp_dialect.ts';

// ---------------------------------------------------------------------------
// The executable evaluator and the frozen task it runs.
// ---------------------------------------------------------------------------

export type {
  EvaluateBackendOptions,
  EvaluationArtifact,
  EvaluationConditions,
  EvaluationSplitArtifact,
  EvaluationStatus,
  EvaluatorTask,
} from './evaluator.ts';
export {
  EVALUATION_ARTIFACT_VERSION,
  EVALUATOR_TASKS,
  evaluateBackend,
  NPC_COMMAND_KIND_TASK,
} from './evaluator.ts';
export { bindDecisionPolicy, resolveBooleanPolicy, resolveChoicePolicy } from './policy.ts';
export { reconstructDecisionValue } from './reconstruct.ts';
export type { RunDecisionOptions } from './runner.ts';
export { runDecision } from './runner.ts';
export type {
  DecisionAbstentionReason,
  DecisionAnalysis,
  DecisionBinding,
  DecisionCapability,
  DecisionCombinationOption,
  DecisionCorrelation,
  DecisionCorrelationMode,
  DecisionDispatch,
  DecisionDispatchUnit,
  DecisionGroupDispatch,
  DecisionIncompatibility,
  DecisionIncompatibilityCode,
  DecisionLanguage,
  DecisionLimits,
  DecisionLiteral,
  DecisionOption,
  DecisionPlan,
  DecisionProbabilityPolicy,
  DecisionProvenance,
  DecisionQuestion,
  DecisionQuestionGroup,
  DecisionQuestionKind,
  DecisionReconstruction,
  DecisionReconstructionFailure,
  DecisionResult,
  DecisionTaskPolicy,
  DecisionTimings,
} from './types.ts';
export {
  DECISION_INCOMPATIBILITY_CODES,
  DECISION_LANGUAGES,
  DEFAULT_DECISION_LIMITS,
} from './types.ts';
export { pathKeyFor, questionKeyFor, stableStringify, utf8ByteLength } from './util.ts';

// ---------------------------------------------------------------------------
// C-567 — readiness, experimental preference, diagnostics, live measurement.
//
// Additive to the C-566 API frozen in docs/research/audits/381-decision-evaluation.md
// §2.3. Nothing here is wired into a shipping call site: the experimental
// preference ships disabled and there is no decision routing in the game.
// ---------------------------------------------------------------------------

export type {
  BuildDecisionDiagnosticsOptions,
  DecisionDiagnosticStage,
  DecisionDiagnostics,
} from './diagnostics.ts';
export { buildDecisionDiagnostics } from './diagnostics.ts';
export type {
  LiveMeasurementResult,
  MeasurementCase,
  MeasurementLatencyGate,
  MeasurementQualityGate,
  RunLiveMeasurementOptions,
  SplitMeasurement,
} from './live_measurement.ts';
export { measureSplit, runLiveDecisionMeasurement } from './live_measurement.ts';
export type {
  DecisionExperimentalPreference,
  DecisionRouteDecision,
  DecisionRouteRefusalCode,
  ResolveDecisionPreferenceOptions,
} from './preference.ts';
export {
  DECISION_EXPERIMENTAL_PREFERENCE,
  DECISION_MINIMUM_BUDGET_MS,
  resolveDecisionPreference,
} from './preference.ts';
export { PROBE_CONTEXT, PROBE_POLICY, PROBE_SCHEMA, PROBE_TASK_ID } from './probe_case.ts';
export type {
  DecisionReadinessProbe,
  DecisionReadinessState,
  DecisionReadinessVerdict,
  DecisionSetupStep,
  ProbeDecisionBackendOptions,
} from './readiness.ts';
export {
  describeDecisionReadiness,
  probeDecisionBackend,
  redactEndpoint,
  redactReason,
} from './readiness.ts';
export type {
  SystemOneListedModel,
  SystemOneProbeFailureState,
  SystemOneProbeOptions,
  SystemOneProbeResult,
} from './systemone_readiness.ts';
export {
  compareDottedVersions,
  DECISION_SCORING_CAPABILITY_TOKENS,
  declaresScoring,
  normalizeModelName,
  parseModelListing,
  probeSystemOneBackend,
  SYSTEM_ONE_MIN_RUNTIME_VERSION,
} from './systemone_readiness.ts';
