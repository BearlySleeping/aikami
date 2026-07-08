// scripts/src/lib/agents/index.ts
/**
 * Swarm director module barrel (v2 — state machine).
 */

export { executeTaskPipeline } from './step_executor';
export {
  executeTaskSocket,
  initializeSwarm,
  snapshotState,
  verifyAgentMapping,
} from './swarm_director';

export type {
  AgentRecord,
  AgentRole,
  AgentStatus,
  FeedbackEntry,
  PipelineState,
  SwarmState,
  SwarmStep,
  TaskPayload,
} from './types';

export { AGENT_ROLES, AGENT_TAB_LABELS, SWARM_WORKSPACE_LABEL } from './types';
