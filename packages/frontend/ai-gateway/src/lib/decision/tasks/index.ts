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
export {
  loadDecisionCorpus,
  loadNpcActionSelectionCorpus,
  NPC_ACTION_SELECTION_DEV,
  NPC_ACTION_SELECTION_HELDOUT,
  NPC_ACTION_SELECTION_SPLITS,
  NPC_COMMAND_KIND_DEV,
  NPC_COMMAND_KIND_HELDOUT,
  NPC_COMMAND_KIND_SPLITS,
} from './fixtures.ts';
export type { NpcActionSelectionProbe } from './npc_action_selection.ts';
// ---------------------------------------------------------------------------
// The production task (lane C). Everything here is reachable from
// `@aikami/frontend-ai-gateway/decision/tasks` and from the measurement
// runner; `decision/index.ts` deliberately does NOT re-export it, because a
// task is not part of the dispatch contract a consumer needs.
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
  NpcActionCorpusCase,
  NpcActionMeasurement,
  NpcActionMeasurementCase,
  NpcActionMeasurementConditions,
  NpcActionMeasurementSplit,
} from './npc_action_selection_measurement.ts';
export { formatSlice, measureNpcActionSelection } from './npc_action_selection_measurement.ts';
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
