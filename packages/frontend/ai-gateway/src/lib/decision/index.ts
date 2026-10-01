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
  SystemOneAdapterOptions,
  SystemOneEndpoints,
  SystemOneTransport,
} from './adapters/systemone_adapter.ts';
export { createSystemOneDecisionAdapter } from './adapters/systemone_adapter.ts';
export type {
  DecisionAdapter,
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
export { bindDecisionPolicy, resolveBooleanPolicy } from './policy.ts';
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
