// scripts/src/lib/agents/types.ts
/**
 * Shared data model types for the Swarm Director & Workspace Provisioning system.
 */

// ── Agent identity ──────────────────────────────────────────

/** The agent roles in the swarm pipeline. Review runs as a script in the director's pane. */
export type AgentRole = 'architect' | 'coder' | 'qa' | 'docs' | 'git' | 'review';

/** All agent roles as a readonly array for iteration. */
export const AGENT_ROLES: readonly AgentRole[] = [
  'architect',
  'coder',
  'qa',
  'docs',
  'git',
] as const;

// ── Pipeline state machine ──────────────────────────────────

/** States in the swarm pipeline state machine. */
export type PipelineState = 'architect' | 'coder' | 'qa' | 'review' | 'docs' | 'git' | 'done';

// ── Agent lifecycle states ──────────────────────────────────

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

// ── Physical tab/pane records ───────────────────────────────

export type AgentRecord = {
  tabId: string;
  paneId: string;
  status: AgentStatus;
  lastHash: string | null;
};

// ── Swarm state snapshot ────────────────────────────────────

export type SwarmState = {
  lastUpdated: string;
  activeTaskId: string | null;
  workspaceId: string | null;
  agents: Record<AgentRole, AgentRecord>;
};

// ── Task payloads ───────────────────────────────────────────

/** A single step in the swarm execution pipeline. */
export type SwarmStep = {
  stepIndex: number;
  agent: AgentRole;
  command: string;
  timeoutMs?: number;
};

/** Task payload fed to the swarm director. */
export type TaskPayload = {
  taskId: string;
  description?: string;
  tier?: string;
  steps: SwarmStep[];
};

// ── Feedback tracking ───────────────────────────────────────

export type FeedbackEntry = {
  iteration: number;
  feedback: string;
  timestamp: string;
};

// ── Herdr JSON response shapes (subset) ─────────────────────

export type HerdrWorkspaceEntry = {
  workspace_id: string;
  label: string;
};

export type HerdrTabEntry = {
  tab_id: string;
  label: string;
};

export type HerdrPaneEntry = {
  pane_id: string;
  tab_id: string;
};

export type HerdrWorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { id: string };
    root_pane: { pane_id: string };
  };
};

export type HerdrTabCreateResult = {
  result: {
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

export type HerdrJsonResponse<T> = {
  result: T;
};

// ── Constants ───────────────────────────────────────────────

export const getSwarmWorkspaceLabel = (taskId?: string): string =>
  taskId ? `aikami-agents-${taskId}` : 'aikami-agents';

export const SWARM_WORKSPACE_LABEL = 'aikami-agents';

export const AGENT_TAB_LABELS: Record<AgentRole, string> = {
  architect: 'architect',
  coder: 'coder',
  qa: 'qa',
  docs: 'docs',
  git: 'git',
  review: 'review',
} as const;
