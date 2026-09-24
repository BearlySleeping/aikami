// scripts/src/lib/agents/subagents/spawn.ts
//
// Launch a subagent: resolve model → provision (worktree for write agents,
// nothing for read agents) → write the run record → start the supervisor in a
// herdr tab (visible, attachable) or as a detached process (no herdr).
//
// Layout in herdr:
//   read agents  → one tab each in the shared `aikami-subagents` workspace
//   write agents → the root tab of their own `aikami-task-<id>` worktree workspace

import { spawn as spawnProcess } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspace, herdr, herdrJson, wrapCommandForPane } from '../../herdr/session.ts';
import { createWorktree } from '../../herdr/worktree.ts';
import { runGit } from '../git_worktree.ts';
import { isThinking, resolveModel, resolveThinking } from './models.ts';
import { buildSystemPrompt, buildTaskMessage } from './prompt.ts';
import {
  emptyUsage,
  newRunId,
  patchState,
  runDir,
  runFile,
  writeSpec,
  writeState,
  writeText,
} from './store.ts';
import type {
  PrOptions,
  ReviewMode,
  SpawnResult,
  SubagentKind,
  SubagentSpec,
  SubagentState,
} from './types.ts';

export const READ_WORKSPACE_LABEL = 'aikami-subagents';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');

export type SpawnRequest = {
  name: string;
  task: string;
  kind?: SubagentKind;
  context?: string;
  model?: string;
  thinking?: string;
  skills?: string[];
  noSkillDiscovery?: boolean;
  tools?: string[];
  excludeTools?: string[];
  base?: string;
  install?: boolean;
  reuseCheckout?: string;
  pr?: Partial<PrOptions> | boolean;
  timeoutMinutes?: number;
  herdr?: boolean;
  repoRoot: string;
  captainSessionId?: string;
};

const DEFAULT_PR: PrOptions = {
  enabled: true,
  base: 'main',
  draft: false,
  review: 'auto',
  autofix: false,
  reviewTimeoutMs: 30 * 60_000,
};

const REVIEW_MODES: readonly ReviewMode[] = ['auto', 'always', 'never'];

const resolvePr = (pr: SpawnRequest['pr'], base: string): PrOptions => {
  if (pr === false) {
    return { ...DEFAULT_PR, base, enabled: false };
  }
  if (pr === true || pr === undefined) {
    return { ...DEFAULT_PR, base };
  }
  if (pr.review !== undefined && !REVIEW_MODES.includes(pr.review)) {
    throw new Error(`pr.review must be one of ${REVIEW_MODES.join(', ')}`);
  }
  return { ...DEFAULT_PR, base, ...pr };
};

export const buildSpec = (request: SpawnRequest): SubagentSpec => {
  const kind = request.kind ?? 'read';
  if (request.thinking !== undefined && !isThinking(request.thinking)) {
    throw new Error(`Invalid thinking level "${request.thinking}"`);
  }
  const { model, source } = resolveModel({ requested: request.model, repoRoot: request.repoRoot });
  const base = request.base ?? 'main';
  return {
    id: newRunId(request.name),
    name: request.name,
    kind,
    task: request.task,
    context: request.context,
    model,
    modelSource: source,
    thinking: resolveThinking(isThinking(request.thinking) ? request.thinking : undefined),
    skills: request.skills ?? [],
    noSkillDiscovery: request.noSkillDiscovery ?? false,
    tools: request.tools,
    excludeTools: request.excludeTools ?? [],
    base,
    install: request.install ?? true,
    reuseCheckout: request.reuseCheckout,
    pr: resolvePr(kind === 'write' ? request.pr : false, base),
    timeoutMs: Math.max(1, request.timeoutMinutes ?? 45) * 60_000,
    herdr: request.herdr ?? true,
    repoRoot: request.repoRoot,
    captainSessionId: request.captainSessionId,
    createdAt: new Date().toISOString(),
  };
};

const herdrReachable = async (): Promise<boolean> => {
  try {
    return (await herdr(['workspace', 'list'], { timeoutMs: 5_000 })).code === 0;
  } catch {
    return false;
  }
};

type Placement = { workspaceId: string; paneId: string; tabId?: string };

type TabCreated = { result: { tab: { tab_id: string }; root_pane: { pane_id: string } } };

/** A new tab in an existing workspace. */
export const openTab = async (options: {
  workspaceId: string;
  cwd: string;
  label: string;
}): Promise<Placement> => {
  const tab = await herdrJson<TabCreated>([
    'tab',
    'create',
    '--workspace',
    options.workspaceId,
    '--cwd',
    options.cwd,
    '--label',
    options.label,
    '--no-focus',
  ]);
  if (!tab?.result) {
    throw new Error('herdr tab create failed');
  }
  return {
    workspaceId: options.workspaceId,
    paneId: tab.result.root_pane.pane_id,
    tabId: tab.result.tab.tab_id,
  };
};

/** One tab per read agent in the shared subagents workspace. */
const placeReadAgent = async (spec: SubagentSpec): Promise<Placement> => {
  const existing = await findWorkspace(READ_WORKSPACE_LABEL);
  if (existing) {
    return openTab({ workspaceId: existing, cwd: spec.repoRoot, label: spec.name });
  }
  const ws = await herdrJson<{
    result: { workspace: { workspace_id: string }; root_pane: { pane_id: string } };
  }>([
    'workspace',
    'create',
    '--cwd',
    spec.repoRoot,
    '--label',
    READ_WORKSPACE_LABEL,
    '--no-focus',
  ]);
  if (!ws?.result) {
    throw new Error('herdr workspace create failed');
  }
  const workspaceId = ws.result.workspace.workspace_id;
  await herdr(['tab', 'rename', `${workspaceId}:1`, spec.name]).catch(() => undefined);
  return { workspaceId, paneId: ws.result.root_pane.pane_id, tabId: `${workspaceId}:1` };
};

const supervisorCommand = (spec: SubagentSpec): string =>
  `bun run ${JSON.stringify(CLI_PATH)} supervise ${spec.id} --repo ${JSON.stringify(spec.repoRoot)}`;

/** Start (or restart, for follow-up rounds) the supervisor for a run. */
export const launchSupervisor = async (spec: SubagentSpec, state: SubagentState): Promise<void> => {
  if (state.paneId) {
    // 🔴 herdr `pane run` can drop the first character — lead with a newline.
    await herdr([
      'pane',
      'run',
      state.paneId,
      `\n${await wrapCommandForPane(state.paneId, supervisorCommand(spec))}`,
    ]);
    return;
  }
  const logPath = join(runDir(spec.repoRoot, spec.id), 'supervisor.log');
  const fd = openSync(logPath, 'a');
  const child = spawnProcess(
    'bun',
    ['run', CLI_PATH, 'supervise', spec.id, '--repo', spec.repoRoot],
    {
      cwd: spec.repoRoot,
      detached: true,
      stdio: ['ignore', fd, fd],
    },
  );
  child.unref();
  patchState(spec.repoRoot, spec.id, { supervisorPid: child.pid });
};

/** Worktree for a write agent (fresh, or a reused checkout). */
const provisionWorktree = async (
  spec: SubagentSpec,
  useHerdr: boolean,
): Promise<{ state: SubagentState; placement?: Placement }> => {
  patchState(spec.repoRoot, spec.id, { status: 'starting', activity: 'provisioning worktree' });
  if (spec.reuseCheckout) {
    const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: spec.reuseCheckout });
    return {
      state: patchState(spec.repoRoot, spec.id, { checkoutPath: spec.reuseCheckout, branch }),
    };
  }
  const w = await createWorktree({
    slug: spec.id,
    base: spec.base,
    repoRoot: spec.repoRoot,
    install: spec.install,
    focus: false,
  });
  const state = patchState(spec.repoRoot, spec.id, {
    checkoutPath: w.checkoutPath,
    branch: w.branch,
  });
  if (!(useHerdr && w.workspaceId && w.rootPaneId)) {
    return { state };
  }
  await herdr(['tab', 'rename', `${w.workspaceId}:1`, 'subagent']).catch(() => undefined);
  return {
    state,
    placement: { workspaceId: w.workspaceId, paneId: w.rootPaneId, tabId: `${w.workspaceId}:1` },
  };
};

const provision = async (
  spec: SubagentSpec,
  state: SubagentState,
): Promise<{ state: SubagentState; placement?: Placement }> => {
  const useHerdr = spec.herdr && (await herdrReachable());
  const provisioned = spec.kind === 'write' ? await provisionWorktree(spec, useHerdr) : { state };
  if (useHerdr && !provisioned.placement) {
    return { ...provisioned, placement: await placeReadAgent(spec) };
  }
  return provisioned;
};

export const spawnSubagent = async (request: SpawnRequest): Promise<SpawnResult> => {
  if (Number(process.env.SUBAGENT_DEPTH ?? '0') > 0) {
    throw new Error('Subagents cannot spawn subagents (SUBAGENT_DEPTH > 0).');
  }
  const spec = buildSpec(request);
  mkdirSync(runDir(spec.repoRoot, spec.id), { recursive: true });
  writeSpec(spec);
  const initial = writeState(spec.repoRoot, {
    id: spec.id,
    status: 'queued',
    updatedAt: new Date().toISOString(),
    usage: emptyUsage(),
    rounds: 0,
  });

  let state: SubagentState;
  let placement: Placement | undefined;
  try {
    ({ state, placement } = await provision(spec, initial));
    writeText(
      runFile(spec.repoRoot, spec.id, 'prompt.md'),
      buildSystemPrompt(spec, { checkoutPath: state.checkoutPath, branch: state.branch }),
    );
    writeText(runFile(spec.repoRoot, spec.id, 'task.md'), buildTaskMessage(spec));
    state = patchState(spec.repoRoot, spec.id, {
      workspaceId: placement?.workspaceId,
      paneId: placement?.paneId,
      tabId: placement?.tabId,
      activity: 'launching',
    });
    await launchSupervisor(spec, state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    patchState(spec.repoRoot, spec.id, {
      status: 'failed',
      error: `spawn failed: ${message}`,
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }

  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    model: spec.model,
    modelSource: spec.modelSource,
    thinking: spec.thinking,
    runDir: runDir(spec.repoRoot, spec.id),
    checkoutPath: state.checkoutPath,
    branch: state.branch,
    workspaceId: placement?.workspaceId,
    paneId: placement?.paneId,
  };
};
