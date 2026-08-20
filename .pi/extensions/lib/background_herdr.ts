// .pi/extensions/lib/background_herdr.ts
//
// Optional live viewer for background tasks. When herdr is reachable (the CLI
// is on PATH — NOT the same gate as herdr_orchestrator's HERDR_ENV check,
// which only registers the full pane tool inside a pane), `bg.watch` mirrors a
// task's journal log into a real terminal tab running `tail -f`, so a human
// or any agent can watch it live.
//
// Layout: a single `aikami-background-tasks` workspace, with ONE numbered tab
// per watched task (labels 1, 2, 3, …). A fresh workspace already owns a root
// tab labelled `1`, so the first watch reuses it and subsequent watches each
// create a new tab. Every tab has its own root pane — no pane splitting.
//
// 🔴 The completion signal stays with the underlying process. We mirror the
// log into a tab; we never treat a tab's scraped output as the exit code.
// The task's own exit code lives in its JSON snapshot.

import { logPath, workspaceLabel } from './background_herdr_shared.ts';
import { runCommand } from './process_runner.ts';

const HERDR_TIMEOUT_MS = 30_000;

export type WatcherHandle = {
  paneId: string;
  workspaceId: string;
  /** The pane can be closed later via `bg.unwatch` or `herdr pane close`. */
  closed: boolean;
};

/** Runs `herdr <args>` and returns trimmed stdout, or null on CLI absence/failure. */
const _herdr = async (args: string[]): Promise<string | null> => {
  const result = await runCommand('herdr', args, { timeoutMs: HERDR_TIMEOUT_MS });
  if ((result.code ?? -1) !== 0) {
    return null;
  }
  return result.stdout.trim();
};

/** True when the herdr CLI is on PATH and reachable. */
export const herdrAvailable = async (): Promise<boolean> => {
  const out = await _herdr(['workspace', 'list']);
  return out !== null;
};

/** Parses `{ result: <T> }`; returns undefined on any parse/absence. */
const _result = <T>(raw: string | null): T | undefined => {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { result?: T };
    return parsed.result;
  } catch {
    return undefined;
  }
};

type Entity = Record<string, unknown>;

// herdr nests created/changed entities inconsistently: some commands return
// `{ result: { tab: {...} } }`, others `{ result: {...itself} }`. These
// extractors locate the entity no matter which shape came back.

const _idOf = (obj: unknown, idKey: string): string | undefined => {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  const o = obj as Entity;
  if (typeof o[idKey] === 'string') {
    return o[idKey] as string;
  }
  return undefined;
};

const _firstId = (root: unknown, idKey: string): string | undefined => {
  if (!root || typeof root !== 'object') {
    return undefined;
  }
  const o = root as Entity;
  // Direct hit on the wrapper.
  const direct = _idOf(o, idKey);
  if (direct) {
    return direct;
  }
  // Nested under a singular entity key (e.g. `result.tab`, `result.pane`,
  // `result.workspace`) or a plural list.
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const id = _idOf(item, idKey);
        if (id) {
          return id;
        }
      }
    } else {
      const id = _idOf(v, idKey);
      if (id) {
        return id;
      }
    }
  }
  return undefined;
};

type Workspace = { workspace_id: string; label: string };
type Tab = { tab_id: string; label: string };
type Pane = { pane_id: string; tab_id: string; workspace_id: string };

let _cachedWorkspaceId: string | undefined;

type Peer = { workspaceId: string; created: boolean };

/** Finds the peer workspace by label, creating it if absent. */
const _findOrCreateWorkspace = async (): Promise<Peer | undefined> => {
  if (_cachedWorkspaceId) {
    return { workspaceId: _cachedWorkspaceId, created: false };
  }
  const label = workspaceLabel();
  const list = _result<{ workspaces: Workspace[] }>(await _herdr(['workspace', 'list']));
  const existing = list?.workspaces?.find((w) => w.label === label);
  if (existing?.workspace_id) {
    _cachedWorkspaceId = existing.workspace_id;
    return { workspaceId: existing.workspace_id, created: false };
  }
  const created = _result<unknown>(
    await _herdr(['workspace', 'create', '--label', label, '--cwd', process.cwd(), '--no-focus']),
  );
  const id = _firstId(created, 'workspace_id');
  if (id) {
    _cachedWorkspaceId = id;
  }
  return id ? { workspaceId: id, created: true } : undefined;
};

const _listTabs = async (workspaceId: string): Promise<Tab[]> =>
  _result<{ tabs: Tab[] }>(await _herdr(['tab', 'list', '--workspace', workspaceId]))?.tabs ?? [];

const _key = (t: Tab): number | undefined => {
  const n = Number(t.label);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Next tab number so watched tasks own distinct tabs: reuses `1` on a fresh workspace, else max+1. */
const _nextTabNumber = async (workspaceId: string, workspaceCreated: boolean): Promise<number> => {
  if (workspaceCreated) {
    return 1;
  }
  const ns = (await _listTabs(workspaceId)).map(_key).filter((n): n is number => n !== undefined);
  return (ns.length === 0 ? 0 : Math.max(...ns)) + 1;
};

/** Pane id inside a tab (each fresh tab owns exactly one root pane). */
const _paneInTab = async (workspaceId: string, tabId: string): Promise<string | undefined> => {
  const panes = _result<{ panes: Pane[] }>(
    await _herdr(['pane', 'list', '--workspace', workspaceId]),
  );
  return panes?.panes?.find((p) => p.tab_id === tabId)?.pane_id;
};

/**
 * Mirrors a task's log into a herdr tab running `tail -f`. Creates the peer
 * workspace if absent, then assigns a numbered tab per task: the first watch
 * (on a fresh workspace) reuses the auto-created root tab `1`, and every
 * subsequent watch creates its own tab. Each tab's single root pane runs the
 * `tail -f` — no pane splitting is performed.
 *
 * Returns null if herdr is unavailable or any step fails (no partial tabs are
 * left dangling on failure).
 */
export const watchTaskInHerdr = async (opts: {
  base: string;
  id: string;
  /** Defaults to the peer workspace label; pass a literal to override. */
  workspace?: string;
}): Promise<WatcherHandle | null> => {
  // Resolve the workspace. When a literal is passed we still need its id.
  let ws: Peer | undefined;
  if (opts.workspace) {
    const raw = _result<{ workspaces: Workspace[] }>(await _herdr(['workspace', 'list']));
    const found = raw?.workspaces?.find((w) => w.label === opts.workspace);
    ws = found ? { workspaceId: found.workspace_id, created: false } : undefined;
  } else {
    ws = await _findOrCreateWorkspace();
  }
  if (!ws) {
    return null;
  }
  const { workspaceId, created } = ws;

  const logFile = logPath(opts.base, opts.id);
  const tabNumber = await _nextTabNumber(workspaceId, created);

  // Use a fresh workspace's existing root tab (labelled `1`) for the first
  // watch; otherwise create a new numbered tab. In both cases the tab has its
  // own pane, so nothing is split.
  let paneId: string | undefined;
  if (tabNumber === 1) {
    const tab1 = (await _listTabs(workspaceId)).find((t) => t.label === '1');
    if (tab1) {
      paneId = await _paneInTab(workspaceId, tab1.tab_id);
    }
  }
  if (!paneId) {
    const createdTab = _result<unknown>(
      await _herdr([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--label',
        String(tabNumber),
        '--cwd',
        process.cwd(),
        '--no-focus',
      ]),
    );
    const tabId = _firstId(createdTab, 'tab_id');
    if (!tabId) {
      return null;
    }
    paneId = (await _paneInTab(workspaceId, tabId)) ?? _firstId(createdTab, 'pane_id');
  }
  if (!paneId) {
    return null;
  }

  // `tail -f` on the journal log; the pane is purely a viewer, the process'
  // exit code never comes from here. If the pane fails to start tail, clean up
  // rather than leaving a dead pane behind.
  const ran = await _herdr(['pane', 'run', paneId, `tail -n +1 -f '${logFile}'`]);
  if (ran === null) {
    await _herdr(['pane', 'close', paneId]);
    return null;
  }

  return { paneId, workspaceId, closed: false };
};

/** Closes a watcher pane created for a background task. */
export const closeWatcherPane = async (paneId: string): Promise<boolean> => {
  const out = await _herdr(['pane', 'close', paneId]);
  return out !== null;
};

export { logPath };
