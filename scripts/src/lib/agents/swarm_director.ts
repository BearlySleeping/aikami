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

// ── Scratchpad database ────────────────────────────────────

/** Path to the SQLite WAL scratchpad database for agent heartbeat tracking. */
const SCRATCHPAD_DB_PATH = '.pi/swarm/agent_scratchpad.db';

/** Cached Database constructor — resolved lazily (bun:sqlite only available in Bun runtime). */
let _DatabaseCtor: new (path: string) => unknown;
let _dbInitAttempted = false;

const _getDatabase = (): (new (path: string) => unknown) => {
  if (_dbInitAttempted) {
    return _DatabaseCtor;
  }
  _dbInitAttempted = true;

  try {
    // Dynamic require — bun:sqlite is only available in the Bun runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _DatabaseCtor = require('bun:sqlite').Database as new (path: string) => unknown;
  } catch {
    // Running under Node.js — heartbeat tracking disabled
  }
  return _DatabaseCtor;
};

/** Open scratchpad DB. Returns null if Bun SQLite unavailable. */
const _openScratchpad = (projectRoot: string): { db: unknown; path: string } | null => {
  const Db = _getDatabase();
  if (!Db) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path');
  const dbPath = join(projectRoot, SCRATCHPAD_DB_PATH);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const db = new Db(dbPath);
  return { db, path: dbPath };
};

/**
 * Initialize the scratchpad SQLite database with the swarm_heartbeat table.
 * Creates the DB at `.pi/agent_scratchpad.db`. Idempotent.
 *
 * Schema: (task_id, agent_key, agent_status, last_heartbeat_timestamp)
 * with UNIQUE(task_id, agent_key) for upsert support.
 */
const initScratchpad = (projectRoot: string): void => {
  const handle = _openScratchpad(projectRoot);
  if (!handle) {
    console.warn('[swarm:scratchpad] Bun SQLite not available — heartbeat tracking disabled');
    return;
  }

  const { db } = handle;
  const dbAny = db as {
    exec: (sql: string) => void;
    query: (sql: string) => { all: () => unknown[]; get: () => unknown };
    close: () => void;
  };

  // Enable WAL mode for concurrent reads
  dbAny.exec('PRAGMA journal_mode=WAL');

  // Create heartbeat table with upsert-ready unique constraint
  dbAny.exec(`
    CREATE TABLE IF NOT EXISTS swarm_heartbeat (
      task_id TEXT NOT NULL,
      agent_key TEXT NOT NULL,
      agent_status TEXT NOT NULL DEFAULT 'idle',
      last_heartbeat_timestamp INTEGER NOT NULL DEFAULT 0,
      agent_output TEXT DEFAULT '',
      UNIQUE(task_id, agent_key)
    )
  `);

  // Migration: add agent_output column if it doesn't exist (pre-existing DBs)
  const cols = dbAny.query("PRAGMA table_info('swarm_heartbeat')").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'agent_output')) {
    dbAny.exec("ALTER TABLE swarm_heartbeat ADD COLUMN agent_output TEXT DEFAULT ''");
    console.debug('[swarm:scratchpad] migrated: added agent_output column');
  }

  // Seed idle rows if table empty
  const row = dbAny.query('SELECT COUNT(*) as cnt FROM swarm_heartbeat').get() as
    | { cnt: number }
    | undefined;
  if (!row || row.cnt === 0) {
    const now = Date.now();
    for (const role of AGENT_ROLES) {
      dbAny.exec(
        `INSERT OR IGNORE INTO swarm_heartbeat (task_id, agent_key, agent_status, last_heartbeat_timestamp) VALUES ('none', '${role}', 'idle', ${now})`,
      );
    }
    console.debug('[swarm:scratchpad] seeded initial heartbeat rows');
  }

  dbAny.close();
  console.debug('[swarm:scratchpad] initialized', { dbPath: handle.path });
};

/**
 * Write a heartbeat update for a single agent during pipeline execution.
 * Uses INSERT OR REPLACE with the UNIQUE(task_id, agent_key) constraint.
 */
export const writeHeartbeat = (
  projectRoot: string,
  taskId: string,
  agentKey: string,
  status: string,
  output?: string,
): void => {
  const handle = _openScratchpad(projectRoot);
  if (!handle) {
    return;
  }

  const { db } = handle;
  const dbAny = db as { exec: (sql: string) => void; close: () => void };
  const now = Date.now();
  const escapedOutput = (output ?? '').replace(/'/g, "''");

  // Upsert via INSERT OR REPLACE (requires UNIQUE constraint)
  dbAny.exec(`
    INSERT OR REPLACE INTO swarm_heartbeat (task_id, agent_key, agent_status, last_heartbeat_timestamp, agent_output)
    VALUES ('${taskId}', '${agentKey}', '${status}', ${now}, '${escapedOutput}')
  `);

  dbAny.close();
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
export const initializeSwarm = async (options: { projectRoot?: string }): Promise<SwarmState> => {
  const { projectRoot = process.cwd() } = options;

  console.debug('[swarm:initialize:start]', { projectRoot });

  await ensureServer();

  // ── Initialize scratchpad database ────────────────────
  initScratchpad(projectRoot);

  // ── Check/restore workspace ────────────────────────────
  let workspaceId = await findWorkspace(SWARM_WORKSPACE_LABEL);

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
  console.debug('[swarm:initialize:creating-workspace]', { label: SWARM_WORKSPACE_LABEL });

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
  writeHeartbeat(process.cwd(), state.activeTaskId ?? 'unknown', step.agent, 'working');

  // Clear stale buffer, send command
  await herdr(['pane', 'send-keys', agent.paneId, 'C-c']);
  await new Promise((r) => setTimeout(r, 200));
  await runInPane(agent.paneId, step.command);
  console.debug('[swarm:step:command-sent]', { agent: step.agent });

  // Wait for pi to start
  await new Promise((r) => setTimeout(r, 2000));

  // Wait for agent to reach done/idle
  const timeoutMs = step.timeoutMs ?? 300_000;
  console.debug('[swarm:step:waiting-agent]', { agent: step.agent, timeoutMs });

  const waitResult = await herdr([
    'wait',
    'agent-status',
    agent.paneId,
    '--status',
    'done',
    '--timeout',
    String(timeoutMs),
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
      throw new Error(`Agent ${step.agent} did not complete within ${timeoutMs}ms`);
    }
  }

  // Quit the pi session with cancel-first pattern
  await herdr(['pane', 'send-keys', agent.paneId, 'C-c']);
  await new Promise((r) => setTimeout(r, 500));
  await runInPane(agent.paneId, '/quit');
  await new Promise((r) => setTimeout(r, 1000));

  // Read summary
  const summary = _readAgentSummary(state.activeTaskId ?? '', step.agent);
  agent.status = 'done';
  state.lastUpdated = new Date().toISOString();
  writeHeartbeat(process.cwd(), state.activeTaskId ?? 'unknown', step.agent, 'done', summary);

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
        writeHeartbeat(process.cwd(), state.activeTaskId ?? 'unknown', step.agent, 'blocked');
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
