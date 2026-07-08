// apps/frontend/client/src/lib/services/agent/index.ts
//
// Agent pipeline module barrel exports.
//
// Contract: C-236 Agent Pipeline System

export {
  AgentPipelineService,
  type AgentPipelineServiceInterface,
  type AgentPipelineServiceOptions,
  agentPipelineService,
} from './agent_pipeline_service.svelte.ts';
export type {
  AgentOutput,
  ExpressionOutput,
  ProseGuardianOutput,
  QuestUpdateOutput,
  SceneDirectionOutput,
  WorldStateExtractionOutput,
} from './agent_schemas.ts';
export {
  expressionSchema,
  proseGuardianSchema,
  questUpdateSchema,
  sceneDirectionSchema,
  worldStateExtractionSchema,
} from './agent_schemas.ts';
export { runExpressionAgent } from './agents/expression_agent.ts';
export { runNarrativeDirectorAgent } from './agents/narrative_director_agent.ts';
export { runProseGuardianAgent } from './agents/prose_guardian_agent.ts';
export { runQuestTrackerAgent } from './agents/quest_tracker_agent.ts';
export { runWorldStateAgent } from './agents/world_state_agent.ts';
export { BUILT_IN_AGENTS } from './built_in_agents.ts';
