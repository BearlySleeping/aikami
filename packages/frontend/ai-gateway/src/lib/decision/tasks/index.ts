// packages/frontend/ai-gateway/src/lib/decision/tasks/index.ts
//
// Public surface of the frozen decision tasks (issue #381).
//
// One task ships today. It is a RESEARCH PROBE on a command-kind discriminator
// and is labelled as one everywhere it is exposed — see
// `npc_command_kind.ts`'s header for exactly what it does and does not prove.

export {
  EVALUATOR_TASKS,
  type EvaluateBackendOptions,
  type EvaluationArtifact,
  type EvaluationStatus,
  type EvaluatorTask,
  NPC_COMMAND_KIND_TASK,
} from '../evaluator.ts';
export type { ChatModelDecisionAdapterOptions } from './chat_model_baseline_adapter.ts';
export { createChatModelDecisionAdapter } from './chat_model_baseline_adapter.ts';
export type { NpcActionDecisionContextInput } from './decision_context.ts';
export { buildNpcActionDecisionContext } from './decision_context.ts';
export {
  loadDecisionCorpus,
  NPC_COMMAND_KIND_DEV,
  NPC_COMMAND_KIND_HELDOUT,
  NPC_COMMAND_KIND_SPLITS,
} from './fixtures.ts';
export type { NpcActionSelectionProbe } from './npc_action_selection.ts';
// ---------------------------------------------------------------------------
// The production task (lane C) — TASK CONTRACT ONLY.
//
// Deliberately narrow, twice over.
//
// `decision/index.ts` does not re-export tasks at all, because a task is not
// part of the dispatch contract a consumer needs. And this barrel stops at the
// CONTRACT: the measurement driver, the chat-model comparator AND the JSON
// fixture corpus are harness data, imported by the evaluation scripts and tests
// BY PATH.
//
// Keeping them out is measured, not theoretical. Re-exporting the fixtures put
// 92 KB of corpus JSON — including every NPC persona and exchange — into the
// shipped client, and the bundle-budget ratchet reported a real +10 % on both
// the `/` and `/settings` initial route closures.
// ---------------------------------------------------------------------------
export {
  isStateChangingAction,
  NPC_ACTION_NONE_ID,
  NPC_ACTION_SELECTION_COMPARATOR,
  NPC_ACTION_SELECTION_LATENCY_GATE,
  NPC_ACTION_SELECTION_LITERALS,
  NPC_ACTION_SELECTION_OMISSIONS,
  NPC_ACTION_SELECTION_OPTION_DESCRIPTIONS,
  NPC_ACTION_SELECTION_POLICY,
  NPC_ACTION_SELECTION_QUALITY_GATE,
  NPC_ACTION_SELECTION_SCHEMA,
  NPC_ACTION_SELECTION_TASK_ID,
  NPC_ACTION_SELECTION_TASK_VERSION,
  npcActionSelectionPolicy,
  npcActionSelectionSchema,
  parseActionLiteral,
} from './npc_action_selection.ts';
export type {
  MeasureNpcActionSelectionOptions,
  NpcActionCallCounts,
  NpcActionCorpusCase,
  NpcActionMeasurement,
  NpcActionMeasurementCase,
  NpcActionMeasurementConditions,
  NpcActionMeasurementSplit,
  NpcActionTimings,
} from './npc_action_selection_measurement_types.ts';
export type { NpcCommandKindProbe } from './npc_command_kind.ts';
export {
  isStateChangingCommand,
  NPC_COMMAND_KIND_COMPARATOR,
  NPC_COMMAND_KIND_LATENCY_GATE,
  NPC_COMMAND_KIND_LITERALS,
  NPC_COMMAND_KIND_NONE,
  NPC_COMMAND_KIND_OPTION_DESCRIPTIONS,
  NPC_COMMAND_KIND_POLICY,
  NPC_COMMAND_KIND_QUALITY_GATE,
  NPC_COMMAND_KIND_SCHEMA,
  NPC_COMMAND_KIND_TASK_ID,
} from './npc_command_kind.ts';
