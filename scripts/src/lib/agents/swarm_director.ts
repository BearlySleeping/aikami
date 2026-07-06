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
import type {
  AgentRecord,
  AgentRole,
  AgentStatus,
  PollingConfig,
  SwarmState,
  SwarmStep,
  TaskPayload,
} from './types';
import {
  AGENT_ROLES,
  AGENT_TAB_LABELS,
  DEFAULT_POLLING_CONFIG,
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

// ── Hash utility ────────────────────────────────────────────

/** Compute a SHA-256 hash of content for scrollback change detection. */
const hashContent = (content: string): string => createHash('sha256').update(content).digest('hex');

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

type PaneReadResult = {
  result: {
    content: string;
  };
};

/** Read scrollback content from a pane. */
const readPaneScrollback = async (paneId: string, lines: number): Promise<string> => {
  const r = await herdrJson<PaneReadResult>([
    'pane',
    'read',
    '--pane',
    paneId,
    '--lines',
    String(lines),
  ]);
  return r?.result?.content ?? '';
};

/** Check if scrollback content matches a compliance signature. */
const checkCompliance = (scrollback: string, signature: RegExp): boolean =>
  signature.test(scrollback);

// ── Pane command execution ──────────────────────────────────

/** Run a command in a target pane via herdr. */
const runInPane = async (paneId: string, command: string): Promise<void> => {
  // Wrap command with direnv for Nix environment
  const wrapped = `direnv exec . bash -c '${command.replace(/'/g, "'\\''")}'`;
  await herdr(['pane', 'run', paneId, wrapped]);
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
export const initializeSwarm = async (options: { projectRoot?: string }): Promise<SwarmState> => {
  const { projectRoot = process.cwd() } = options;

  console.debug('[swarm:initialize:start]', { projectRoot });

  await ensureServer();

  // ── Check/restore workspace ────────────────────────────
  let workspaceId = await findWorkspace(SWARM_WORKSPACE_LABEL);

  if (workspaceId) {
    console.debug('[swarm:initialize:workspace-found]', { workspaceId });

    // Workspace exists — map existing tabs to agent roles
    const existingLabels = await getTabLabels(workspaceId);
    const panes = await getPanes(workspaceId);

    const state = createInitialState(workspaceId);

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
  console.debug('[swarm:initialize:creating-workspace]', { label: SWARM_WORKSPACE_LABEL });

  const firstRole = AGENT_ROLES[0];
  const firstLabel = AGENT_TAB_LABELS[firstRole];

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
    SWARM_WORKSPACE_LABEL,
    '--no-focus',
  ]);

  if (!createResult?.result) {
    throw new Error(`Failed to create workspace: ${SWARM_WORKSPACE_LABEL}`);
  }

  workspaceId = createResult.result.workspace.workspace_id;

  // Rename first tab and set it as the initial agent tab
  await herdr(['tab', 'rename', `${workspaceId}:1`, firstLabel]);

  const state = createInitialState(workspaceId);
  state.agents[firstRole] = {
    tabId: createResult.result.tab.id,
    paneId: createResult.result.root_pane.pane_id,
    status: 'idle',
    lastHash: null,
  };

  console.debug('[swarm:initialize:first-tab-created]', { role: firstRole });

  // Create remaining role tabs
  for (let i = 1; i < AGENT_ROLES.length; i++) {
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
 * poll scrollback until compliance signature is detected or timeout.
 *
 * AC-2: Asynchronous Step Execution and Scrollback Compliance Checks
 * - Updates logical status to `working`
 * - Polls console scrollbacks incrementally via herdr pane read
 * - Scans for distinct compliance signatures
 * - Blocks downstream steps until preceding actions resolve
 */
const executeStep = async (options: {
  step: SwarmStep;
  state: SwarmState;
  config?: PollingConfig;
}): Promise<void> => {
  const { step, state, config = DEFAULT_POLLING_CONFIG } = options;
  const agent = state.agents[step.agent];

  if (!agent || agent.paneId === '') {
    throw new Error(`Agent ${step.agent} has no mapped pane`);
  }

  console.debug('[swarm:step:start]', {
    stepIndex: step.stepIndex,
    agent: step.agent,
    paneId: agent.paneId,
  });

  // ── Mark agent as working ──────────────────────────────
  agent.status = 'working';
  state.lastUpdated = new Date().toISOString();

  // ── Send command to target pane ────────────────────────
  await runInPane(agent.paneId, step.command);
  console.debug('[swarm:step:command-sent]', { agent: step.agent });

  // Give the shell a moment to start processing
  await new Promise((r) => setTimeout(r, 500));

  // ── Poll scrollback ────────────────────────────────────
  for (let poll = 0; poll < config.maxPolls; poll++) {
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));

    const scrollback = await readPaneScrollback(agent.paneId, config.scrollbackLines);
    const currentHash = hashContent(scrollback);

    // ── Check compliance ─────────────────────────────────
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

    // ── Progress detection ───────────────────────────────
    if (agent.lastHash !== null && currentHash !== agent.lastHash) {
      console.debug('[swarm:step:progress]', {
        stepIndex: step.stepIndex,
        agent: step.agent,
        poll,
      });
    }

    agent.lastHash = currentHash;
  }

  // ── Timeout ────────────────────────────────────────────
  agent.status = 'blocked';
  state.lastUpdated = new Date().toISOString();

  throw new Error(
    `Step ${step.stepIndex} (${step.agent}) timed out after ${config.maxPolls} polls`,
  );
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
  config?: PollingConfig;
}): Promise<SwarmState> => {
  const { payload, state, config } = options;

  console.log('[swarm:task:start]', {
    taskId: payload.taskId,
    steps: payload.steps.length,
  });

  state.activeTaskId = payload.taskId;

  for (const step of payload.steps) {
    await executeStep({ step, state, config });
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
export const snapshotState = async (): Promise<SwarmState> => {
  await ensureServer();

  const workspaceId = await findWorkspace(SWARM_WORKSPACE_LABEL);
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
