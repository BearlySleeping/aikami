// scripts/src/lib/agents/types.ts
/**
 * Shared data model types for the Swarm Director & Workspace Provisioning system.
 *
 * All types are self-contained since agent lifecycle tracking is specific to
 * the swarm director and does not cross monorepo project boundaries.
 */

// ── Agent identity ──────────────────────────────────────────

/** The four semantic agent roles in the swarm workspace. */
export type AgentRole = 'architect' | 'coder' | 'qa' | 'git';

/** All agent roles as a readonly array for iteration. */
export const AGENT_ROLES: readonly AgentRole[] = ['architect', 'coder', 'qa', 'git'] as const;

// ── Agent lifecycle states ──────────────────────────────────

/**
 * Agent lifecycle status.
 *
 * - `idle`:      Tab is provisioned but no task assigned.
 * - `working`:   Command is executing; scrollback is being polled.
 * - `blocked`:   Downstream dependency has not resolved yet.
 * - `done`:      Compliance signature detected in scrollback.
 * - `unknown`:   Pane mapping has not been verified yet (initial state).
 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

// ── Physical tab/pane records ───────────────────────────────

/** Physical mapping of a herdr tab + pane to an agent role. */
export type AgentRecord = {
  /** herdr tab identifier (e.g. "aikami-agents:1") */
  tabId: string;
  /** herdr pane identifier (UUID) */
  paneId: string;
  /** Current lifecycle status */
  status: AgentStatus;
  /** Last known scrollback content hash for change detection */
  lastHash: string | null;
};

// ── Swarm state snapshot ────────────────────────────────────

/** Full swarm director state serialized for persistence. */
export type SwarmState = {
  /** ISO-8601 timestamp of last state mutation */
  lastUpdated: string;
  /** Currently executing task id, or null if idle */
  activeTaskId: string | null;
  /** herdr workspace uuid */
  workspaceId: string | null;
  /** Role → agent record mapping */
  agents: Record<AgentRole, AgentRecord>;
};

// ── Task payloads ───────────────────────────────────────────

/**
 * A single step in the swarm execution pipeline.
 * Each step targets a specific agent and carries a command payload.
 */
export type SwarmStep = {
  /** Order index (0-based) */
  stepIndex: number;
  /** Target agent role */
  agent: AgentRole;
  /** Command to execute in the target pane */
  command: string;
  /** Regex pattern that, when matched in scrollback, marks this step as done */
  complianceSignature: RegExp;
  /** Optional timeout in ms before step is considered stalled */
  timeoutMs?: number;
};

/** Task payload fed to the swarm director. */
export type TaskPayload = {
  /** Unique task identifier (e.g. contract number) */
  taskId: string;
  /** Ordered execution steps */
  steps: SwarmStep[];
};

// ── Polling configuration ───────────────────────────────────

export type PollingConfig = {
  /** Interval between scrollback polls (ms) */
  pollIntervalMs: number;
  /** Maximum consecutive polls before timeout */
  maxPolls: number;
  /** Lines to capture per scrollback read */
  scrollbackLines: number;
};

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  pollIntervalMs: 2000,
  maxPolls: 60,
  scrollbackLines: 100,
} as const;

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

/** Generic herdr JSON response wrapper. */
export type HerdrJsonResponse<T> = {
  result: T;
};

// ── Constants ───────────────────────────────────────────────

/** Workspace label for the swarm agent workspace. */
export const SWARM_WORKSPACE_LABEL = 'aikami-agents';

/** Tab labels for each agent role. */
export const AGENT_TAB_LABELS: Record<AgentRole, string> = {
  architect: 'architect',
  coder: 'coder',
  qa: 'qa',
  git: 'git',
} as const;
