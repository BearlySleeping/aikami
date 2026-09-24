// .pi/extensions/lib/subagent_watch.ts
//
// Cheap, Node-only observation of subagent runs: reads
// <repo>/.pi/subagent-runs/<id>/{spec,state}.json directly. Waiting never
// shells out — a stat+parse every ~1.5s per run is effectively free, whereas a
// `bun run` bridge call per poll would cost ~150ms of CPU each.
//
// Mutations (spawn/kill/message/cleanup) go through the bridge instead.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TERMINAL_STATUSES } from '../../../scripts/src/lib/agents/subagents/constants.ts';
import type {
  SubagentSpec,
  SubagentState,
  SubagentStatus,
} from '../../../scripts/src/lib/agents/subagents/types.ts';

export const isTerminalStatus = (s: SubagentStatus): boolean => TERMINAL_STATUSES.includes(s);

/** Main checkout root, even when pi runs inside a worktree. */
export const mainRepoRoot = (cwd: string): string => {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return resolve(common, '..');
  } catch {
    return cwd;
  }
};

const runsDir = (repoRoot: string): string => join(repoRoot, '.pi', 'subagent-runs');

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

const pidAlive = (pid: number | undefined): boolean => {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export type RunSnapshot = { spec: SubagentSpec; state: SubagentState };

/**
 * Snapshot with liveness folded in (read-only — the Bun side persists `lost`
 * on its next read). A live-looking run whose supervisor is gone is `lost`.
 */
export const readRun = (repoRoot: string, id: string): RunSnapshot | undefined => {
  const dir = join(runsDir(repoRoot), id);
  const spec = readJson<SubagentSpec>(join(dir, 'spec.json'));
  const state = readJson<SubagentState>(join(dir, 'state.json'));
  if (!spec || !state) {
    return undefined;
  }
  if (!isTerminalStatus(state.status)) {
    const age = Date.now() - Date.parse(state.updatedAt);
    const graceful = !state.supervisorPid && age < 60_000;
    if (!graceful && !pidAlive(state.supervisorPid)) {
      return {
        spec,
        state: { ...state, status: 'lost', error: state.error ?? 'supervisor exited' },
      };
    }
  }
  return { spec, state };
};

export const listRunIds = (repoRoot: string): string[] => {
  const dir = runsDir(repoRoot);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('sa-'))
    .map((e) => e.name);
};

export const readResultText = (repoRoot: string, id: string): string | undefined => {
  const path = join(runsDir(repoRoot), id, 'result.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

export const resultPath = (repoRoot: string, id: string): string =>
  join(runsDir(repoRoot), id, 'result.md');

// ── Formatting ─────────────────────────────────────────────────────

const ICON: Record<SubagentStatus, string> = {
  queued: '⏳',
  starting: '⏳',
  running: '🏃',
  publishing: '📦',
  reviewing: '🐰',
  succeeded: '✅',
  failed: '❌',
  killed: '🛑',
  lost: '👻',
};

const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

export const headline = ({ spec, state }: RunSnapshot): string => {
  const start = Date.parse(state.startedAt ?? spec.createdAt);
  const end = state.finishedAt ? Date.parse(state.finishedAt) : Date.now();
  const u = state.usage;
  const cost = u.cost > 0 ? ` · $${u.cost.toFixed(4)}` : ' · $0';
  return (
    `${ICON[state.status]} ${spec.id} ${state.status} (${spec.kind}, ${spec.name}) · ` +
    `${fmtDuration(end - start)} · ${u.turns} turns · ${u.toolCalls} tools${cost}` +
    (!isTerminalStatus(state.status) && state.activity ? ` — ${state.activity}` : '')
  );
};

const reviewLine = (r: NonNullable<SubagentState['review']>): string => {
  const review = r.state ? ` · review ${r.state} (${r.findings ?? 0} findings)` : '';
  const commit = r.autofixCommit ? ` ${r.autofixCommit.slice(0, 7)}` : '';
  const autofix = r.autofix ? ` · autofix ${r.autofix}${commit}` : '';
  return `CodeRabbit: ${r.decision} — ${r.reason}${review}${autofix}`;
};

/** Optional metadata lines — each entry is present only when its field is. */
const metaLines = ({ spec, state }: RunSnapshot): string[] => {
  const thinking = spec.thinking ? `:${spec.thinking}` : '';
  const branch = state.branch ? ` (branch ${state.branch})` : '';
  const stray = state.strayWrites ?? [];
  const optional: (string | false | undefined)[] = [
    state.checkoutPath && `checkout: ${state.checkoutPath}${branch}`,
    state.pr && `PR #${state.pr.number}: ${state.pr.url}`,
    state.review && reviewLine(state.review),
    state.error && `error: ${state.error}`,
    stray.length > 0 && `⚠️ read agent changed the main checkout: ${stray.join(', ')}`,
  ];
  return [
    `model: ${spec.model}${thinking} (${spec.modelSource})`,
    ...optional.filter((l): l is string => typeof l === 'string'),
  ];
};

const resultLines = (repoRoot: string, id: string, maxChars: number): string[] => {
  const result = readResultText(repoRoot, id);
  if (!result) {
    return [];
  }
  if (result.length <= maxChars) {
    return ['', '── result ──', result.trim()];
  }
  return [
    '',
    '── result ──',
    `${result.slice(0, maxChars).trim()}\n…(truncated)`,
    `(full result: ${resultPath(repoRoot, id)})`,
  ];
};

/** Full terminal report handed to the captain. */
export const report = (repoRoot: string, run: RunSnapshot, maxChars: number): string =>
  [headline(run), ...metaLines(run), ...resultLines(repoRoot, run.spec.id, maxChars)].join('\n');
