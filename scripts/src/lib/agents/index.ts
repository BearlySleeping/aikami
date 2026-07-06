// scripts/src/lib/agents/index.ts
/**
 * Swarm director module barrel.
 */

export { executeTask, initializeSwarm, snapshotState, verifyAgentMapping } from './swarm_director';

export type {
  AgentRecord,
  AgentRole,
  AgentStatus,
  PollingConfig,
  SwarmState,
  SwarmStep,
  TaskPayload,
} from './types';

export { AGENT_ROLES, AGENT_TAB_LABELS, SWARM_WORKSPACE_LABEL } from './types';
