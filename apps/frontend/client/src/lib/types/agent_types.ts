// apps/frontend/client/src/lib/types/agent_types.ts
//
// Client-local types for the Agent Pipeline System. These are
// UI-layer constructs specific to the Aikami Client — not cross-boundary
// data — so they live in the app's local types.
//
// Contract: C-236 Agent Pipeline System

import type { AgentPhase } from '@aikami/types';

export type { AgentPhase };

// ── Agent Configuration ──────────────────────────────────────────────────

/**
 * Configuration for a single agent in the pipeline.
 */
export type AgentConfig = {
  /** Unique agent identifier. */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** Execution phase. */
  phase: AgentPhase;
  /** System prompt instructions for the agent. */
  systemPrompt: string;
  /** Timeout in milliseconds for agent execution. */
  timeout: number;
  /** Whether this agent is enabled by default. */
  enabled: boolean;
  /** For pre-agents: section key used when injecting output into the system prompt. */
  contextKey?: string;
};

// ── Agent Run Result ─────────────────────────────────────────────────────

/**
 * Result of executing a single agent in the pipeline.
 */
export type AgentRunResult = {
  /** ID of the agent that produced this result. */
  agentId: string;
  /** Phase during which the agent ran. */
  phase: AgentPhase;
  /** Whether the agent completed successfully. */
  success: boolean;
  /** Parsed output from the agent (shape depends on agent type). */
  output?: unknown;
  /** Error message if the agent failed. */
  error?: string;
  /** Wall-clock duration of agent execution in milliseconds. */
  durationMs: number;
};

// ── Pipeline Context ─────────────────────────────────────────────────────

/**
 * Context passed through the pipeline stages — accumulates pre-agent
 * results so the main generation's system prompt can be enriched.
 */
export type AgentPipelineContext = {
  /** The chat/conversation ID. */
  chatId: string;
  /** Optional NPC ID if in NPC chat mode. */
  npcId?: string;
  /** The raw user message text. */
  userMessage: string;
  /** The assembled system prompt (from GM prompt service). */
  systemPrompt: string;
  /** Results from all pre-agents that completed successfully. */
  preResults: AgentRunResult[];
};

// ── Thought Bubble ───────────────────────────────────────────────────────

/**
 * A single thought bubble showing what an agent is "thinking" during execution.
 */
export type ThoughtBubble = {
  /** Unique bubble identifier. */
  id: string;
  /** ID of the agent that produced this thought. */
  agentId: string;
  /** Human-readable agent name. */
  agentName: string;
  /** Display text for the thought. */
  text: string;
  /** Phase when the thought was emitted. */
  phase: AgentPhase;
  /** Timestamp of the thought. */
  timestamp: number;
};

// ── Agent HUD State ──────────────────────────────────────────────────────

/**
 * Reactive state for the Agent HUD overlay UI.
 */
export type AgentHudState = {
  /** Whether the pipeline is currently executing. */
  isRunning: boolean;
  /** Current phase being executed (null when idle). */
  currentPhase: AgentPhase | null;
  /** Name of the currently running agent (null when idle). */
  currentAgent: string | null;
  /** All results from the current pipeline run. */
  results: AgentRunResult[];
  /** Recent thought bubbles from current run. */
  thoughtBubbles: ThoughtBubble[];
  /** Whether the HUD drawer is visible. */
  showDrawer: boolean;
  /** IDs of agents that are enabled for the current chat. */
  enabledAgents: string[];
};

// ── Custom Agent Definition (C-247) ──────────────────────────────────────

/**
 * Full custom agent definition — extends AgentConfig with user-facing
 * metadata, serialized output schema, and ownership fields.
 *
 * Contract: C-247 Custom Agent Creation
 */
export type CustomAgentDefinition = {
  /** Format version for forward compatibility. */
  formatVersion: '1.0.0';
  /** Discriminator for import/export format. */
  type: 'agent_definition';
  /** Unique agent identifier (generated on create). */
  id: string;
  /** Human-readable agent name (1-60 chars). */
  name: string;
  /** User-facing description of what the agent does (max 500 chars). */
  description: string;
  /** Optional folder for organization (e.g. "Combat", "World"). */
  folder?: string;
  /** Execution phase. */
  phase: AgentPhase;
  /** Prompt template with optional macro placeholders ({{user}}, {{input}}, etc.). */
  promptTemplate: string;
  /** JSON Schema for validating the agent's structured output. */
  outputSchema: Record<string, unknown>;
  /** Result discriminator key (e.g. 'tracker_state', 'memory', 'command', 'custom'). */
  resultType: string;
  /** Optional connection ID override (use a different model than the chat). */
  connectionId?: string;
  /** Timeout in milliseconds (default: 15000). */
  timeout: number;
  /** Whether this agent is currently enabled. */
  enabled: boolean;
  /** Always false for custom agents. */
  isBuiltIn: false;
  /** For pre-agents: section key used when injecting output into the system prompt. */
  contextKey?: string;
  /** Owner user ID. */
  uid: string;
  /** Creation timestamp (ISO 8601). */
  createdAt: string;
  /** Last update timestamp (ISO 8601). */
  updatedAt: string;
};

/**
 * Input shape for creating a new custom agent (no server-generated fields).
 */
export type CreateAgentInput = Omit<
  CustomAgentDefinition,
  'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn' | 'formatVersion' | 'type' | 'uid' | 'enabled'
>;

/**
 * Input shape for updating an existing custom agent.
 */
export type UpdateAgentInput = Partial<
  Omit<CustomAgentDefinition, 'id' | 'createdAt' | 'isBuiltIn' | 'formatVersion' | 'type' | 'uid'>
>;
