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
export type { DecisionFixtureFile, DecisionFixtureProvenance } from './fixtures.ts';
export {
  loadDecisionCorpus,
  NPC_COMMAND_KIND_DEV,
  NPC_COMMAND_KIND_HELDOUT,
  NPC_COMMAND_KIND_SPLITS,
} from './fixtures.ts';
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
