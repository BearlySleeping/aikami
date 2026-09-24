// scripts/src/lib/agents/subagents/store.ts
//
// Filesystem state for subagent runs. Every mutation is an atomic
// write-then-rename so a concurrent reader (the captain's watcher polls
// state.json) never observes a torn file.
//
// 🔴 State lives in the CAPTAIN's repo root (.pi/subagent-runs/, gitignored),
// never inside a worktree — a worktree can be removed while its run record
// must survive for `result`/`list`.

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  type SubagentSpec,
  type SubagentState,
  type SubagentUsage,
  TERMINAL_STATUSES,
} from './types.ts';

export const RUNS_DIR = '.pi/subagent-runs';

export const runsRoot = (repoRoot: string): string => join(repoRoot, RUNS_DIR);

export const runDir = (repoRoot: string, id: string): string => join(runsRoot(repoRoot), id);

export const runFile = (
  repoRoot: string,
  id: string,
  file: 'spec.json' | 'state.json' | 'prompt.md' | 'task.md' | 'events.jsonl' | 'result.md',
): string => join(runDir(repoRoot, id), file);

/** `sa-<slug>-<4 hex>` — short enough to type, unique enough to never collide. */
export const newRunId = (name: string): string => {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'agent';
  return `sa-${slug}-${randomBytes(2).toString('hex')}`;
};

export const emptyUsage = (): SubagentUsage => ({
  turns: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cost: 0,
});

const atomicWrite = (path: string, content: string): void => {
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
};

const readJson = <T>(path: string): T | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

export const writeSpec = (spec: SubagentSpec): void => {
  mkdirSync(runDir(spec.repoRoot, spec.id), { recursive: true });
  atomicWrite(runFile(spec.repoRoot, spec.id, 'spec.json'), JSON.stringify(spec, undefined, 2));
};

export const readSpec = (repoRoot: string, id: string): SubagentSpec | undefined =>
  readJson<SubagentSpec>(runFile(repoRoot, id, 'spec.json'));

export const readState = (repoRoot: string, id: string): SubagentState | undefined =>
  readJson<SubagentState>(runFile(repoRoot, id, 'state.json'));

export const writeState = (repoRoot: string, state: SubagentState): SubagentState => {
  const next = { ...state, updatedAt: new Date().toISOString() };
  atomicWrite(runFile(repoRoot, state.id, 'state.json'), JSON.stringify(next, undefined, 2));
  return next;
};

/** Read-modify-write. The supervisor is the only writer while a run is live. */
export const patchState = (
  repoRoot: string,
  id: string,
  patch: Partial<SubagentState>,
): SubagentState => {
  const current = readState(repoRoot, id);
  if (!current) {
    throw new Error(`No subagent run "${id}" under ${runsRoot(repoRoot)}`);
  }
  return writeState(repoRoot, { ...current, ...patch });
};

export const isTerminal = (state: SubagentState): boolean =>
  TERMINAL_STATUSES.includes(state.status);

/** True when the pid exists (signal 0 probes without delivering anything). */
export const pidAlive = (pid: number | undefined): boolean => {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = exists but owned by someone else — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * State with liveness folded in: a non-terminal run whose supervisor died
 * (machine reboot, herdr tab closed by hand) is reported — and persisted —
 * as `lost`, so waiters never hang on a run that can no longer finish.
 */
export const readLiveState = (repoRoot: string, id: string): SubagentState | undefined => {
  const state = readState(repoRoot, id);
  if (!state || isTerminal(state)) {
    return state;
  }
  // Grace period: the supervisor pid is recorded a moment after spawn.
  const ageMs = Date.now() - Date.parse(state.updatedAt);
  if (!state.supervisorPid && ageMs < 60_000) {
    return state;
  }
  if (pidAlive(state.supervisorPid)) {
    return state;
  }
  return writeState(repoRoot, {
    ...state,
    status: 'lost',
    finishedAt: new Date().toISOString(),
    error: state.error ?? 'Supervisor process exited without recording a final status.',
  });
};

export const listRunIds = (repoRoot: string): string[] => {
  const root = runsRoot(repoRoot);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('sa-'))
    .map((e) => e.name);
};

export const writeText = (path: string, content: string): void => atomicWrite(path, content);

export const readText = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined;
