// scripts/src/lib/agents/swarm_director.ts
/**
 * Swarm Director & Workspace Provisioning Lifecycle Manager.
 *
 * Connects to the local herdr multiplexer socket to automatically spin up,
 * map, and orchestrate four logical execution environments (architect, coder,
 * qa, and git) within a persistent workspace named 'aikami-agents'.
 *
 * The director manages the full job pipeline, tracks foreground process
 * lifecycles, and evaluates step compliance to coordinate task delegation
 * safely.
 *
 * @module swarm_director
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentScratchpad, type SwarmStateRow } from '../agent_scratchpad';
import type {
  AgentRecord,
  AgentRole,
  AgentStatus,
  HerdrTabCreateResult,
  PollingConfig,
  SwarmState,
  SwarmStep,
  TaskPayload,
} from './types';
import {
  AGENT_ROLES,
  AGENT_TAB_LABELS,
  DEFAULT_POLLING_CONFIG,
  DIRECTOR_TAB_LABEL,
  getSwarmWorkspaceLabel,
  SWARM_WORKSPACE_LABEL,
} from './types';

// ── Herdr CLI helpers ───────────────────────────────────────

type HerdrResult = {
  code: number;
  stdout: string;
};

/** Execute a herdr CLI command and return stdout + exit code. */
const herdr = (args: string[]): Promise<HerdrResult> =>
  new Promise((resolveH) => {
    const proc = spawn('herdr', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout?.on('data', (d) => {
      out += String(d);
    });
    proc.on('close', (code) => resolveH({ code: code ?? 1, stdout: out }));
  });

/** Execute a herdr command that returns JSON. Returns parsed result or null. */
const herdrJson = async <T>(args: string[]): Promise<T | null> => {
  const r = await herdr(args);
  if (r.code !== 0 || !r.stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(r.stdout.trim()) as T;
  } catch {
    return null;
  }
};

/** Check if the herdr server daemon is running. */
const isServerRunning = async (): Promise<boolean> => {
  const r = await herdr(['status', 'server']);
  return r.code === 0 && /status:\s*running/i.test(r.stdout);
};

/** Ensure the herdr headless server is running. */
const ensureServer = async (): Promise<void> => {
  if (await isServerRunning()) {
    return;
  }
  const proc = spawn('herdr', ['server'], {
    stdio: 'ignore',
    env: process.env,
  });
  proc.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning()) {
      return;
    }
  }
  try {
    proc.kill();
  } catch {
    // ignore
  }
  throw new Error('herdr server did not start within timeout');
};

// ── Scratchpad (from agent_scratchpad module) ─────────────

/** Singleton scratchpad instance — created once per process. */
const _pad = createAgentScratchpad({
  dbPath: join(process.cwd(), '.pi/swarm/agent_scratchpad.db'),
  agentId: 'swarm-director',
});

const _writeHeartbeat = (options: {
  taskId: string;
  agentKey: string;
  status: string;
  output?: string;
}): void => {
  _pad.upsertHeartbeat({
    taskId: options.taskId,
    workspaceId: 'default',
    agentKey: options.agentKey,
    agentStatus: options.status as SwarmStateRow['agentStatus'],
    lastContextHash: null,
    lastHeartbeatTimestamp: Date.now(),
    agentOutput: options.output ?? '',
  });
};

// ── Hash utility ────────────────────────────────────────────

/** Compute a SHA-256 hash of content for scrollback change detection. */
const hashContent = (content: string): string => createHash('sha256').update(content).digest('hex');

/**
 * Read an agent's summary file from the outputs directory.
 * Returns empty string if no summary was written.
 */
const _readAgentSummary = (taskId: string, agent: string): string => {
  const summaryPath = join(process.cwd(), '.pi/swarm/outputs', `${taskId}_${agent}.md`);
  try {
    return readFileSync(summaryPath, 'utf-8').slice(0, 4096);
  } catch {
    return '';
  }
};

// ── State helpers ───────────────────────────────────────────

/**
 * Create a fresh initial swarm state with unknown status for all agents.
 */
const createInitialState = (workspaceId: string | null): SwarmState => {
  const agents = Object.fromEntries(
    AGENT_ROLES.map((role) => [
      role,
      {
        tabId: '',
        paneId: '',
        status: 'unknown' as AgentStatus,
        lastHash: null,
      },
    ]),
  ) as Record<AgentRole, AgentRecord>;

  return {
    lastUpdated: new Date().toISOString(),
    activeTaskId: null,
    workspaceId,
    agents,
  };
};

/** Update the lastUpdated timestamp and return a fresh state snapshot. */
const touchState = (state: SwarmState): SwarmState => ({
  ...state,
  lastUpdated: new Date().toISOString(),
});

// ── Workspace discovery helpers ─────────────────────────────

type WorkspaceListEntry = {
  workspace_id: string;
  label: string;
};

type WorkspaceListResult = {
  result: {
    workspaces: WorkspaceListEntry[];
  };
};

/** Find a workspace by label. Returns id or null. */
const findWorkspace = async (label: string): Promise<string | null> => {
  const r = await herdrJson<WorkspaceListResult>(['workspace', 'list']);
  const ws = r?.result?.workspaces?.find((w) => w.label === label);
  return ws?.workspace_id ?? null;
};

// ── Tab/pane discovery ──────────────────────────────────────

type TabListEntry = {
  tab_id: string;
  label: string;
};

type TabListResult = {
  result: {
    tabs: TabListEntry[];
  };
};

type PaneListEntry = {
  pane_id: string;
  tab_id: string;
};

type PaneListResult = {
  result: {
    panes: PaneListEntry[];
  };
};

/** Get all tab labels in a workspace. */
const getTabLabels = async (workspaceId: string): Promise<string[]> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  return r?.result?.tabs?.map((t) => t.label) ?? [];
};

/** Find a tab by label in a workspace. Returns tab_id or null. */
const findTab = async (workspaceId: string, label: string): Promise<string | null> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  const tab = r?.result?.tabs?.find((t) => t.label === label);
  return tab?.tab_id ?? null;
};

/** Get all panes for a workspace. */
const getPanes = async (workspaceId: string): Promise<PaneListEntry[]> => {
  const r = await herdrJson<PaneListResult>(['pane', 'list', '--workspace', workspaceId]);
  return r?.result?.panes ?? [];
};

// ── Scrollback polling ──────────────────────────────────────

/** Read scrollback content from a pane. Returns raw text. */
const readPaneScrollback = async (paneId: string, lines: number): Promise<string> => {
  // Use --source visible as default source (recent) returns empty for fresh panes
  const r = await herdr(['pane', 'read', paneId, '--source', 'visible', '--lines', String(lines)]);
  return r.code === 0 ? r.stdout : '';
};

/** Check if scrollback content matches a compliance signature. */
const checkCompliance = (scrollback: string, signature?: RegExp): boolean =>
  signature ? signature.test(scrollback) : false;

// ── Pane command execution ──────────────────────────────────

/** Run a command in a target pane via herdr. */
const runInPane = async (paneId: string, command: string): Promise<void> => {
  // Pane shell already has direnv loaded — send command directly
  await herdr(['pane', 'run', paneId, command]);
};

// ── Workspace provisioning (AC-1) ───────────────────────────

/**
 * Initialize the swarm workspace with four agent role tabs.
 *
 * AC-1: Swarm Workspace Initialization and Role Mapping
 * - Verifies existence of the `aikami-agents` workspace
 * - Provisions missing role tabs (architect, coder, qa, git)
 * - Maps physical PTY identifiers to the internal state schema
 * - Writes a confirmation log
 *
 * @returns Populated SwarmState with mapped pane identifiers.
 */
export const initializeSwarm = async (options: {
  projectRoot?: string;
  taskId?: string;
}): Promise<SwarmState> => {
  const { projectRoot = process.cwd(), taskId } = options;
  const workspaceLabel = getSwarmWorkspaceLabel(taskId);

  console.debug('[swarm:initialize:start]', { projectRoot, workspaceLabel });

  await ensureServer();

  // ── Initialize scratchpad database ────────────────────
  console.debug('[swarm:scratchpad] using AgentScratchpad');

  // ── Check/restore workspace ────────────────────────────
  let workspaceId = await findWorkspace(workspaceLabel);

  if (workspaceId) {
    console.debug('[swarm:initialize:workspace-found]', { workspaceId });

    // Workspace exists — map existing tabs to agent roles
    const existingLabels = await getTabLabels(workspaceId);
    const panes = await getPanes(workspaceId);

    const state = createInitialState(workspaceId);

    // ── Ensure director tab exists ────────────────────────
    if (!existingLabels.includes(DIRECTOR_TAB_LABEL)) {
      console.debug('[swarm:initialize:provisioning-director]');
      // Rename the first tab if it has a default name, otherwise create new
      const tabResult = await herdrJson<HerdrTabCreateResult>([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        projectRoot,
        '--label',
        DIRECTOR_TAB_LABEL,
        '--no-focus',
      ]);
      if (tabResult?.result) {
        console.debug('[swarm:tab:provisioned]', {
          role: 'director',
          tabId: tabResult.result.tab.tab_id,
          paneId: tabResult.result.root_pane.pane_id,
        });
      }
      // Re-fetch panes after creating director tab
      const updatedPanes = await getPanes(workspaceId);
      // Find director pane (newest pane)
      const existingPaneIds = new Set(panes.map((p) => p.pane_id));
      const directorPane = updatedPanes.find((p) => !existingPaneIds.has(p.pane_id));
      if (directorPane) {
        console.debug('[swarm:initialize:director-pane]', { paneId: directorPane.pane_id });
      }
    }

    // ── Map agent tabs ────────────────────────────────────
    for (const role of AGENT_ROLES) {
      const label = AGENT_TAB_LABELS[role];

      if (existingLabels.includes(label)) {
        const tabId = await findTab(workspaceId, label);
        const pane = panes.find((p) => p.tab_id === tabId);

        state.agents[role] = {
          tabId: tabId ?? '',
          paneId: pane?.pane_id ?? '',
          status: 'idle',
          lastHash: null,
        };
        console.debug('[swarm:initialize:agent-mapped]', { role, tabId, paneId: pane?.pane_id });
      } else {
        // Provision missing tab
        const provisioned = await _provisionTab(workspaceId, role, projectRoot);
        state.agents[role] = provisioned;
      }
    }

    console.log('[swarm:initialize:restored]', {
      workspaceId,
      agents: Object.entries(state.agents).map(([r, a]) => `${r}=${a.status}`),
    });

    return touchState(state);
  }

  // ── Create new workspace ───────────────────────────────
  console.debug('[swarm:initialize:creating-workspace]', { label: workspaceLabel });

  type WorkspaceCreateResult = {
    result: {
      workspace: { workspace_id: string };
      tab: { id: string };
      root_pane: { pane_id: string };
    };
  };

  const createResult = await herdrJson<WorkspaceCreateResult>([
    'workspace',
    'create',
    '--cwd',
    projectRoot,
    '--label',
    workspaceLabel,
    '--no-focus',
  ]);

  if (!createResult?.result) {
    throw new Error(`Failed to create workspace: ${workspaceLabel}`);
  }

  workspaceId = createResult.result.workspace.workspace_id;

  // Rename first tab to director — this is where swarm_start.ts runs
  await herdr(['tab', 'rename', `${workspaceId}:1`, DIRECTOR_TAB_LABEL]);
  console.debug('[swarm:initialize:director-tab-created]', {
    tabId: createResult.result.tab.id,
    paneId: createResult.result.root_pane.pane_id,
  });

  const state = createInitialState(workspaceId);

  // ── Create agent role tabs ────────────────────────────
  for (let i = 0; i < AGENT_ROLES.length; i++) {
    const role = AGENT_ROLES[i];
    const provisioned = await _provisionTab(workspaceId, role, projectRoot);
    state.agents[role] = provisioned;
  }

  await new Promise((r) => setTimeout(r, 1000));

  console.log('[swarm:initialize:workspace-created]', {
    workspaceId,
    agents: Object.entries(state.agents).map(([r, a]) => `${r}=${a.status}`),
  });

  return touchState(state);
};

/**
 * Provision a single role tab in the workspace.
 */
const _provisionTab = async (
  workspaceId: string,
  role: AgentRole,
  projectRoot: string,
): Promise<AgentRecord> => {
  const label = AGENT_TAB_LABELS[role];

  type TabCreateResult = {
    result: {
      tab: { tab_id: string };
      root_pane: { pane_id: string };
    };
  };

  const tabResult = await herdrJson<TabCreateResult>([
    'tab',
    'create',
    '--workspace',
    workspaceId,
    '--cwd',
    projectRoot,
    '--label',
    label,
    '--no-focus',
  ]);

  if (!tabResult?.result) {
    throw new Error(`Failed to create tab for agent role: ${role}`);
  }

  console.debug('[swarm:tab:provisioned]', { role, tabId: tabResult.result.tab.tab_id });

  return {
    tabId: tabResult.result.tab.tab_id,
    paneId: tabResult.result.root_pane.pane_id,
    status: 'idle',
    lastHash: null,
  };
};

// ── Step execution (AC-2) ───────────────────────────────────

/**
 * Execute a single swarm step: send command to target agent pane,
 * wait for agent completion via herdr native detection, read summary.
 *
 * Replaces the old marker-file + scrollback polling approach with
 * herdr's native agent-status detection and wait_agent CLI.
 */
const _executeStepOnce = async (options: {
  step: SwarmStep;
  state: SwarmState;
  agent: AgentRecord;
  attempt: number;
  maxRetries: number;
}): Promise<void> => {
  const { step, state, agent, attempt } = options;

  console.debug('[swarm:step:start]', {
    stepIndex: step.stepIndex,
    agent: step.agent,
    paneId: agent.paneId,
    attempt,
  });

  // Mark working
  agent.status = 'working';
  state.lastUpdated = new Date().toISOString();
  _writeHeartbeat({
    taskId: state.activeTaskId ?? 'unknown',
    agentKey: step.agent,
    status: 'working',
  });

  // Send command to target pane (session stays open between steps)
  await runInPane(agent.paneId, step.command);
  console.debug('[swarm:step:command-sent]', { agent: step.agent });

  // Wait for pi to start
  await new Promise((r) => setTimeout(r, 2000));

  // Wait for agent to reach done/idle
  // Reasonable timeout — scrollback fallback catches real completion
  const agentTimeoutMs = 120_000;
  console.debug('[swarm:step:waiting-agent]', { agent: step.agent });

  const waitResult = await herdr([
    'wait',
    'agent-status',
    agent.paneId,
    '--status',
    'done',
    '--timeout',
    String(agentTimeoutMs),
  ]);

  if (waitResult.code !== 0) {
    // Fallback: try idle status
    const idleResult = await herdr([
      'wait',
      'agent-status',
      agent.paneId,
      '--status',
      'idle',
      '--timeout',
      '10000',
    ]);
    if (idleResult.code !== 0) {
      // Fallback 2: scan scrollback for completion marker
      const markers: Record<string, string> = {
        architect: '\\[architect\\]\\s+plan\\s+complete',
        coder: 'COMPLIANCE_CODER_DONE',
        qa: '\\[qa\\]\\s+all\\s+tests\\s+passed',
        git: '\\[git\\]\\s+committed',
      };
      const marker = markers[step.agent];
      if (marker) {
        console.debug('[swarm:step:fallback-scrollback]', { agent: step.agent });
        const outputResult = await herdr([
          'wait',
          'output',
          agent.paneId,
          '--match',
          marker,
          '--regex',
          '--source',
          'visible',
          '--timeout',
          '60000',
        ]);
        if (outputResult.code !== 0) {
          throw new Error(`Agent ${step.agent} did not complete`);
        }
      } else {
        throw new Error(`Agent ${step.agent} did not complete`);
      }
    }
  }

  // Read summary (session stays open — user can inspect output)
  const summary = _readAgentSummary(state.activeTaskId ?? '', step.agent);
  agent.status = 'done';
  state.lastUpdated = new Date().toISOString();
  _writeHeartbeat({
    taskId: state.activeTaskId ?? 'unknown',
    agentKey: step.agent,
    status: 'done',
    output: summary,
  });

  console.log('[swarm:step:done]', {
    stepIndex: step.stepIndex,
    agent: step.agent,
    summaryLen: summary.length,
    attempt,
  });
};
const executeStep = async (options: { step: SwarmStep; state: SwarmState }): Promise<void> => {
  const { step, state } = options;
  const agent = state.agents[step.agent];
  const maxRetries = step.maxRetries ?? 1;

  if (!agent || agent.paneId === '') {
    throw new Error(`Agent ${step.agent} has no mapped pane`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await _executeStepOnce({ step, state, agent, attempt, maxRetries });
      return;
    } catch (error) {
      if (attempt >= maxRetries) {
        agent.status = 'blocked';
        state.lastUpdated = new Date().toISOString();
        _writeHeartbeat({
          taskId: state.activeTaskId ?? 'unknown',
          agentKey: step.agent,
          status: 'blocked',
        });
        throw error;
      }
      console.warn(
        `[swarm:step:retry] ${step.agent} attempt ${attempt}/${maxRetries} failed: ${error}`,
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
};

// ── Full task pipeline ──────────────────────────────────────

/**
 * Execute a full task payload through the swarm.
 *
 * Steps are executed sequentially. Each step blocks until its
 * compliance signature is detected or the step times out.
 */
export const executeTask = async (options: {
  payload: TaskPayload;
  state: SwarmState;
}): Promise<SwarmState> => {
  const { payload, state } = options;

  // ── Derive contract workspace for cleanup ─────────────
  const workspaceLabel = getSwarmWorkspaceLabel(payload.taskId);
  console.debug('[swarm:task:workspace]', { workspaceLabel });

  // ── Active session guard ─────────────────────────────
  if (state.activeTaskId) {
    console.warn('[swarm:task:active-session]', {
      existingTask: state.activeTaskId,
      newTask: payload.taskId,
    });
    // Clear stale agent states — if any agent is working/blocked from a previous run
    for (const role of AGENT_ROLES) {
      const agent = state.agents[role];
      if (agent.status === 'working' || agent.status === 'blocked') {
        agent.status = 'idle';
        console.debug('[swarm:task:reset-agent]', { role, prevStatus: agent.status });
      }
    }
  }

  console.log('[swarm:task:start]', {
    taskId: payload.taskId,
    steps: payload.steps.length,
  });

  // ── Clean up existing pi sessions from previous pipeline runs ──────
  // Keeps output visible in scrollback, starts clean for new pipeline.
  console.debug('[swarm:task:quitting-sessions]');
  for (const role of AGENT_ROLES) {
    const agentPane = state.agents[role];
    if (agentPane.paneId) {
      await runInPane(agentPane.paneId, '/quit');
    }
  }
  await new Promise((r) => setTimeout(r, 2000));

  // ── Clean up stale markers from previous runs ──────
  const markersDir = join(process.cwd(), '.pi/swarm/markers');
  mkdirSync(markersDir, { recursive: true });

  // Ensure outputs directory exists for agent summaries
  const outputsDir = join(process.cwd(), '.pi/swarm/outputs');
  mkdirSync(outputsDir, { recursive: true });

  const taskPrefix = payload.taskId;
  try {
    for (const entry of readdirSync(markersDir)) {
      if (entry.startsWith(taskPrefix)) {
        unlinkSync(join(markersDir, entry));
        console.debug('[swarm:task:cleanup]', { marker: entry });
      }
    }
  } catch {
    // directory might not exist yet — fine
  }

  state.activeTaskId = payload.taskId;

  for (const step of payload.steps) {
    await executeStep({ step, state });
  }

  state.activeTaskId = null;
  state.lastUpdated = new Date().toISOString();

  console.log('[swarm:task:complete]', { taskId: payload.taskId });

  return state;
};

// ── State snapshot ──────────────────────────────────────────

/**
 * Take a snapshot of the current swarm state by re-scanning
 * workspace tabs and panes from herdr.
 */
export const snapshotState = async (taskId?: string): Promise<SwarmState> => {
  await ensureServer();

  const workspaceLabel = taskId ? getSwarmWorkspaceLabel(taskId) : SWARM_WORKSPACE_LABEL;
  const workspaceId = await findWorkspace(workspaceLabel);
  if (!workspaceId) {
    return createInitialState(null);
  }

  const tabLabels = await getTabLabels(workspaceId);
  const panes = await getPanes(workspaceId);

  const state = createInitialState(workspaceId);

  for (const role of AGENT_ROLES) {
    const label = AGENT_TAB_LABELS[role];
    if (tabLabels.includes(label)) {
      const tabId = await findTab(workspaceId, label);
      const pane = panes.find((p) => p.tab_id === tabId);
      state.agents[role] = {
        tabId: tabId ?? '',
        paneId: pane?.pane_id ?? '',
        status: 'idle',
        lastHash: null,
      };
    }
  }

  return touchState(state);
};

/**
 * Verify that all four agent roles are mapped and the workspace exists.
 * Used as a pre-flight check before task execution.
 */
export const verifyAgentMapping = (state: SwarmState): boolean =>
  AGENT_ROLES.every((role) => {
    const agent = state.agents[role];
    return agent.paneId !== '' && agent.tabId !== '';
  });

// ── C-306: Non-blocking stream pipes ──────────────────────

/**
 * Sliding timeout barrier configuration for non-blocking pane reads.
 */
export type StreamTimeoutConfig = {
  /** Maximum time to wait for pane read (ms) */
  readTimeoutMs: number;
  /** Heartbeat interval for agent status updates (ms) */
  heartbeatIntervalMs: number;
  /** Maximum time an agent can be in 'working' state before being flagged stale (ms) */
  stallTimeoutMs: number;
};

export const DEFAULT_STREAM_CONFIG: StreamTimeoutConfig = {
  readTimeoutMs: 15_000,
  heartbeatIntervalMs: 5_000,
  stallTimeoutMs: 60_000,
} as const;

/**
 * Non-blocking pane read with aggressive temporal window timeout.
 *
 * C-306 AC-1: Cross-Pane Deadlock Prevention
 * - Wraps herdr pane read with a Promise.race timeout
 * - Returns partial content on timeout instead of hanging
 * - Never blocks the director thread indefinitely
 */
export const readPaneNonBlocking = async (options: {
  paneId: string;
  lines: number;
  timeoutMs?: number;
}): Promise<{ content: string; timedOut: boolean }> => {
  const { paneId, lines, timeoutMs = DEFAULT_STREAM_CONFIG.readTimeoutMs } = options;

  const readPromise = readPaneScrollback(paneId, lines);

  const timeoutPromise = new Promise<{ content: string; timedOut: boolean }>((resolveT) =>
    setTimeout(() => resolveT({ content: '', timedOut: true }), timeoutMs),
  );

  const result = await Promise.race([
    readPromise.then((content) => ({ content, timedOut: false })),
    timeoutPromise,
  ]);

  return result;
};

// ── C-306: Exponential backoff for OCC retries ─────────────

/**
 * Configuration for exponential backoff with jitter.
 */
export type BackoffConfig = {
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
};

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 50,
  maxDelayMs: 2000,
  maxRetries: 5,
} as const;

/**
 * Compute exponential backoff delay with random jitter.
 *
 * Prevents thundering herd on concurrent write retries during
 * optimistic concurrency conflict resolution.
 */
export const backoffDelay = (attempt: number, config: BackoffConfig = DEFAULT_BACKOFF): number => {
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
  const jitter = Math.random() * config.baseDelayMs;
  return exponential + jitter;
};

/**
 * Retry an async operation with exponential backoff on error.
 *
 * Watch point: All retry loops handling OCC conflicts must use backoff jitter
 * to minimize write collisions across rapid execution cycles.
 */
export const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  config: BackoffConfig = DEFAULT_BACKOFF,
  shouldRetry?: (error: unknown) => boolean,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === config.maxRetries) {
        break;
      }

      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      const delay = backoffDelay(attempt, config);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
};

// ── C-306: Stalled agent detection ────────────────────────

/**
 * Check for stalled agents based on heartbeat recency.
 *
 * AC-1: Cross-Pane Deadlock Prevention and Heartbeat Resiliency
 * - Enforces a strict sliding timeout barrier
 * - Flags agents as 'blocked' or 'unknown' if heartbeat is stale
 * - Safely unlocks adjacent pipeline operations
 */
export const detectStalledAgents = (
  state: SwarmState,
  heartbeatTimestamps: Record<AgentRole, number>,
  stallTimeoutMs: number = DEFAULT_STREAM_CONFIG.stallTimeoutMs,
): AgentRole[] => {
  const stalled: AgentRole[] = [];
  const now = Date.now();

  for (const role of AGENT_ROLES) {
    const agent = state.agents[role];
    if (agent.status !== 'working' && agent.status !== 'blocked') {
      continue;
    }

    const lastBeat = heartbeatTimestamps[role] ?? 0;
    if (now - lastBeat > stallTimeoutMs) {
      stalled.push(role);
    }
  }

  return stalled;
};

// ── C-306: Resilience-enhanced step execution ─────────────

/**
 * Execute a single swarm step with non-blocking reads and heartbeat tracking.
 *
 * Enhanced version of executeStep with:
 * - Non-blocking pane reads (Promise.race with timeout)
 * - Heartbeat timestamp updates for stall detection
 * - Automatic agent status transition to 'blocked' on stall
 */
export const executeStepResilient = async (options: {
  step: SwarmStep;
  state: SwarmState;
  config?: PollingConfig;
  streamConfig?: StreamTimeoutConfig;
  heartbeatTimestamps?: Record<AgentRole, number>;
}): Promise<void> => {
  const {
    step,
    state,
    config = DEFAULT_POLLING_CONFIG,
    streamConfig = DEFAULT_STREAM_CONFIG,
    heartbeatTimestamps,
  } = options;

  const agent = state.agents[step.agent];

  if (!agent || agent.paneId === '') {
    throw new Error(`Agent ${step.agent} has no mapped pane`);
  }

  console.debug('[swarm:step:resilient:start]', {
    stepIndex: step.stepIndex,
    agent: step.agent,
    paneId: agent.paneId,
  });

  // ── Mark agent as working ──────────────────────────────
  agent.status = 'working';
  state.lastUpdated = new Date().toISOString();

  if (heartbeatTimestamps) {
    heartbeatTimestamps[step.agent] = Date.now();
  }

  // ── Send command to target pane ────────────────────────
  // Clear stale input buffer to prevent command concatenation
  await herdr(['pane', 'send-keys', agent.paneId, 'C-c']);
  await new Promise((r) => setTimeout(r, 200));

  await runInPane(agent.paneId, step.command);

  await new Promise((r) => setTimeout(r, 500));

  // ── Non-blocking poll loop ────────────────────────────
  for (let poll = 0; poll < config.maxPolls; poll++) {
    // ── Heartbeat update ────────────────────────────────
    if (heartbeatTimestamps) {
      heartbeatTimestamps[step.agent] = Date.now();
    }

    await new Promise((r) => setTimeout(r, config.pollIntervalMs));

    const { content: scrollback, timedOut } = await readPaneNonBlocking({
      paneId: agent.paneId,
      lines: config.scrollbackLines,
      timeoutMs: streamConfig.readTimeoutMs,
    });

    if (timedOut) {
      console.debug('[swarm:step:read-timeout]', {
        stepIndex: step.stepIndex,
        agent: step.agent,
        poll,
      });

      // Check if agent is stalled
      if (heartbeatTimestamps) {
        const stalled = detectStalledAgents(
          state,
          heartbeatTimestamps,
          streamConfig.stallTimeoutMs,
        );
        if (stalled.includes(step.agent)) {
          agent.status = 'blocked';
          state.lastUpdated = new Date().toISOString();
          throw new Error(
            `Agent ${step.agent} stalled — no heartbeat for ${streamConfig.stallTimeoutMs}ms`,
          );
        }
      }
      continue;
    }

    const currentHash = hashContent(scrollback);

    if (checkCompliance(scrollback, step.complianceSignature)) {
      agent.status = 'done';
      agent.lastHash = currentHash;
      state.lastUpdated = new Date().toISOString();
      console.log('[swarm:step:done]', {
        stepIndex: step.stepIndex,
        agent: step.agent,
        polls: poll + 1,
      });
      return;
    }

    if (agent.lastHash !== null && currentHash !== agent.lastHash) {
      console.debug('[swarm:step:progress]', {
        stepIndex: step.stepIndex,
        agent: step.agent,
        poll,
      });
    }

    agent.lastHash = currentHash;
  }

  // ── Timeout — mark as blocked ─────────────────────────
  agent.status = 'blocked';
  state.lastUpdated = new Date().toISOString();

  throw new Error(
    `Step ${step.stepIndex} (${step.agent}) timed out after ${config.maxPolls} polls`,
  );
};
