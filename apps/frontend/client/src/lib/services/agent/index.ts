// apps/frontend/client/src/lib/services/agent/index.ts
//
// Agent pipeline module barrel exports.
//
// Contracts: C-236 Agent Pipeline System, C-247 Custom Agent Creation

export {
  AgentPipelineService,
  type AgentPipelineServiceInterface,
  type AgentPipelineServiceOptions,
  agentPipelineService,
} from './agent_pipeline_service.svelte.ts';
export {
  AgentRegistryService,
  type AgentRegistryServiceInterface,
  type AgentRegistryServiceOptions,
  agentRegistryService,
} from './agent_registry_service.svelte.ts';
export type {
  AgentOutput,
  CyoaAgentOutput,
  ExpressionOutput,
  MusicCueOutput,
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
export { runCyoaAgent } from './agents/cyoa_agent.ts';
export { runExpressionAgent } from './agents/expression_agent.ts';
export { runMusicDjAgent } from './agents/music_dj_agent.ts';
export { runNarrativeDirectorAgent } from './agents/narrative_director_agent.ts';
export { runProseGuardianAgent } from './agents/prose_guardian_agent.ts';
export { runQuestTrackerAgent } from './agents/quest_tracker_agent.ts';
export { runSchedulePlannerAgent } from './agents/schedule_planner_agent.ts';
export { runWorldStateAgent } from './agents/world_state_agent.ts';
export { BUILT_IN_AGENTS } from './built_in_agents.ts';
export { customAgentToConfig, runCustomAgent } from './custom_agent_factory.ts';
