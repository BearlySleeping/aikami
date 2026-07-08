// scripts/src/lib/agents/swarm_director.ts
/**
 * Swarm Director & Workspace Provisioning Lifecycle Manager.
 *
 * Connects to the local herdr multiplexer socket to automatically spin up,
 * map, and orchestrate agent execution environments (architect, coder, qa, git)
 * within a persistent workspace.
 *
 * Pipeline execution is delegated to step_executor.ts (state machine).
 * This module handles workspace provisioning and the socket-Task entry point.
 *
 * @module swarm_director
 */

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HerdrSocketClient } from '../herdr/socket_client';
import { createAgentScratchpad } from './agent_scratchpad';
import type { AgentRecord, AgentRole, AgentStatus, SwarmState, TaskPayload } from './types';
import {
  AGENT_ROLES,
  AGENT_TAB_LABELS,
  getSwarmWorkspaceLabel,
  SWARM_WORKSPACE_LABEL,
} from './types';

// ── Herdr CLI helpers ───────────────────────────────────────

type HerdrResult = {
  code: number;
  stdout: string;
};

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

const isServerRunning = async (): Promise<boolean> => {
  const r = await herdr(['status', 'server']);
  return r.code === 0 && /status:\s*running/i.test(r.stdout);
};

const ensureServer = async (): Promise<void> => {
  if (await isServerRunning()) {
    return;
  }
  const proc = spawn('herdr', ['server'], { stdio: 'ignore', env: process.env });
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

// ── State helpers ───────────────────────────────────────────

const createInitialState = (workspaceId: string | null): SwarmState => {
  const agents = Object.fromEntries(
    AGENT_ROLES.map((role) => [
      role,
      { tabId: '', paneId: '', status: 'unknown' as AgentStatus, lastHash: null },
    ]),
  ) as Record<AgentRole, AgentRecord>;
  return { lastUpdated: new Date().toISOString(), activeTaskId: null, workspaceId, agents };
};

const touchState = (state: SwarmState): SwarmState => ({
  ...state,
  lastUpdated: new Date().toISOString(),
});

// ── Workspace discovery ─────────────────────────────────────

type WorkspaceListResult = {
  result: { workspaces: Array<{ workspace_id: string; label: string }> };
};

const findWorkspace = async (label: string): Promise<string | null> => {
  const r = await herdrJson<WorkspaceListResult>(['workspace', 'list']);
  const ws = r?.result?.workspaces?.find((w) => w.label === label);
  return ws?.workspace_id ?? null;
};

// ── Tab/pane discovery ──────────────────────────────────────

type TabListResult = { result: { tabs: Array<{ tab_id: string; label: string }> } };
type PaneListResult = { result: { panes: Array<{ pane_id: string; tab_id: string }> } };

const getTabLabels = async (workspaceId: string): Promise<string[]> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  return r?.result?.tabs?.map((t) => t.label) ?? [];
};

const findTab = async (workspaceId: string, label: string): Promise<string | null> => {
  const r = await herdrJson<TabListResult>(['tab', 'list', '--workspace', workspaceId]);
  const tab = r?.result?.tabs?.find((t) => t.label === label);
  return tab?.tab_id ?? null;
};

const getPanes = async (
  workspaceId: string,
): Promise<Array<{ pane_id: string; tab_id: string }>> => {
  const r = await herdrJson<PaneListResult>(['pane', 'list', '--workspace', workspaceId]);
  return r?.result?.panes ?? [];
};

// ── Workspace provisioning (AC-1) ───────────────────────────

export const initializeSwarm = async (options: {
  projectRoot?: string;
  taskId?: string;
}): Promise<SwarmState> => {
  const { projectRoot = process.cwd(), taskId } = options;
  const workspaceLabel = getSwarmWorkspaceLabel(taskId);

  console.debug('[swarm:initialize:start]', { projectRoot, workspaceLabel });
  await ensureServer();

  let workspaceId = await findWorkspace(workspaceLabel);

  if (workspaceId) {
    console.debug('[swarm:initialize:workspace-found]', { workspaceId });
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
      } else {
        const provisioned = await _provisionTab(workspaceId, role, projectRoot);
        state.agents[role] = provisioned;
      }
    }

    // ── Pipeline log tab (tail) ──────────────────────────
    await _provisionPipelineTab(workspaceId, taskId, existingLabels, projectRoot);

    console.log('[swarm:initialize:restored]', {
      workspaceId,
      agents: Object.entries(state.agents).map(([r, a]) => `${r}=${a.status}`),
    });
    return touchState(state);
  }

  // Create new workspace
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
  await herdr(['tab', 'rename', `${workspaceId}:1`, AGENT_TAB_LABELS.architect]);

  const state = createInitialState(workspaceId);
  state.agents.architect = {
    tabId: createResult.result.tab.id,
    paneId: createResult.result.root_pane.pane_id,
    status: 'idle',
    lastHash: null,
  };

  for (const role of AGENT_ROLES) {
    if (role === 'architect') {
      continue;
    }
    const provisioned = await _provisionTab(workspaceId, role, projectRoot);
    state.agents[role] = provisioned;
  }

  // ── Pipeline log tab ──────────────────────────────────
  await _provisionPipelineTab(workspaceId, taskId, [], projectRoot);

  await new Promise((r) => setTimeout(r, 1000));

  console.log('[swarm:initialize:workspace-created]', {
    workspaceId,
    agents: Object.entries(state.agents).map(([r, a]) => `${r}=${a.status}`),
  });
  return touchState(state);
};

const _provisionTab = async (
  workspaceId: string,
  role: AgentRole,
  projectRoot: string,
): Promise<AgentRecord> => {
  const label = AGENT_TAB_LABELS[role];
  type TabCreateResult = { result: { tab: { tab_id: string }; root_pane: { pane_id: string } } };

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

const PIPELINE_TAB_LABEL = 'pipeline';

/**
 * Provision or verify the pipeline log tab (tails the director log).
 *
 * Idempotent — if the tab already exists it's left alone.
 * The tab runs `tail -f` on the pipeline log; useful for watching
 * state transitions in --join mode (detached process writes to the log).
 */
const _provisionPipelineTab = async (
  workspaceId: string,
  taskId: string | undefined,
  existingLabels: string[],
  projectRoot: string,
): Promise<void> => {
  if (!taskId) {
    return;
  }
  if (existingLabels.includes(PIPELINE_TAB_LABEL)) {
    console.debug('[swarm:tab:pipeline-exists]', { workspaceId });
    return;
  }

  const logPath = `.pi/swarm/outputs/${taskId}_pipeline.log`;
  // tab create returns the new pane; we immediately run tail -f without waiting
  // for an agent handoff (the pipeline tab is purely informational).
  type TabCreateResult = { result: { tab: { tab_id: string }; root_pane: { pane_id: string } } };
  const tabResult = await herdrJson<TabCreateResult>([
    'tab',
    'create',
    '--workspace',
    workspaceId,
    '--cwd',
    projectRoot,
    '--label',
    PIPELINE_TAB_LABEL,
    '--no-focus',
  ]);

  if (!tabResult?.result) {
    console.warn('[swarm:tab:pipeline-failed] could not create pipeline tab');
    return;
  }

  // Touch the log file so tail doesn't error on missing file
  mkdirSync(join(projectRoot, '.pi/swarm/outputs'), { recursive: true });
  appendFileSync(join(projectRoot, logPath), '');

  // Run tail -f in the new pane
  await herdr(['pane', 'run', tabResult.result.root_pane.pane_id, `tail -f ${logPath}`]);
  console.debug('[swarm:tab:pipeline-created]', { tabId: tabResult.result.tab.tab_id });
};

// ── State snapshot ──────────────────────────────────────────

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

export const verifyAgentMapping = (state: SwarmState): boolean =>
  AGENT_ROLES.every((role) => {
    const agent = state.agents[role];
    return agent.paneId !== '' && agent.tabId !== '';
  });

// ── Socket-based task execution (C-311 v2) ──────────────────

/**
 * Execute a full task pipeline via the state machine in step_executor.ts.
 */
export const executeTaskSocket = async (options: {
  payload: TaskPayload;
  state: SwarmState;
  socketClient: HerdrSocketClient;
  tier?: string;
  skipReview?: boolean;
  resume?: boolean;
}): Promise<SwarmState> => {
  const {
    payload,
    state,
    socketClient,
    tier = 'flash',
    skipReview = false,
    resume = true,
  } = options;
  const taskId = payload.taskId;
  const contractPath =
    ((payload as Record<string, unknown>).contractPath as string) ?? `docs/contracts/${taskId}.md`;
  const startTime = Date.now();

  console.debug('[swarm:task:socket]', { taskId, contractPath, tier, skipReview });

  // Active session guard
  if (state.activeTaskId) {
    console.warn('[swarm:task:active-session]', {
      existingTask: state.activeTaskId,
      newTask: taskId,
    });
    for (const role of AGENT_ROLES) {
      const agent = state.agents[role];
      if (agent.status === 'working' || agent.status === 'blocked') {
        agent.status = 'idle';
      }
    }
  }

  console.log('[swarm:task:start]', { taskId, mode: 'socket', contractPath, skipReview });

  // Delegate to state machine pipeline
  const { executeTaskPipeline } = await import('./step_executor');

  // Use singleton scratchpad instance
  const scratchpad = createAgentScratchpad({
    dbPath: join(process.cwd(), '.pi/swarm/agent_scratchpad.db'),
    agentId: 'swarm-director',
  });

  await executeTaskPipeline({
    taskId,
    state,
    socketClient,
    scratchpad,
    projectRoot: process.cwd(),
    contractPath,
    tier,
    skipReview,
    resume,
  });

  // Collect metrics
  const { collectAndWriteMetrics } = await import('./metrics_collector');
  collectAndWriteMetrics({
    taskId,
    startTime,
    trivialPath: state.agents.qa.status === 'done' && state.agents.coder.status === 'done',
    documentationGenerated: false,
  });

  console.log('[swarm:task:complete]', { taskId, mode: 'socket' });
  return state;
};
