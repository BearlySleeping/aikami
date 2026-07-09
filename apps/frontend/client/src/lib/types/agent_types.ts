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
