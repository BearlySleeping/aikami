// .pi/extensions/herdr-orchestrator.ts
//
// Consolidated herdr extension for pi — pane orchestration, agent wait, dev
// service management, and swarm slash commands.
//
// Merged from:
//   examples/pi-herdr.ts (upstream pi docs) — full pane orchestration
//   herdr-orchestrator.ts (aikami)                — dev service lifecycle
//
// Uses bare `typebox` import (aikami convention).
//
// ═══════════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════════
//
//   herdr           — full pane orchestration (list, run, read, watch,
//                     wait_agent, pane_split, send, stop, focus, tabs,
//                     workspaces)
//   herdr_session   — aikami dev service lifecycle (start, stop, status,
//                     read, list)

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

type WorkspaceInfo = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
};

type TabInfo = {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
};

type PaneInfo = {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  agent?: string;
  agent_status: AgentStatus;
};

type ManagedPane = { paneId: string; workspaceId: string };

// ═══════════════════════════════════════════════════════════════════════════
// HERDR CLI HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const execHerdr = async (
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const result = await pi.exec('herdr', args, { signal } as any);
  if (signal?.aborted || result.killed) {
    throw new Error('Aborted');
  }
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
};

const execHerdrJson = async <T>(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<T> => {
  const { code, stdout } = await execHerdr(pi, args, signal);
  if (code !== 0) {
    throw new Error(`herdr ${args.join(' ')} exited ${code}`);
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`herdr ${args.join(' ')} produced no output`);
  }
  const parsed = JSON.parse(trimmed) as { result?: T; error?: { message?: string } };
  if (parsed.error) {
    throw new Error(parsed.error.message ?? 'herdr error');
  }
  return parsed.result as T;
};

const execHerdrText = async (
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<string> => {
  const { stdout } = await execHerdr(pi, args, signal);
  return stdout;
};

// ═══════════════════════════════════════════════════════════════════════════
// PANE REGISTRY (aliases survive session rebuild)
// ═══════════════════════════════════════════════════════════════════════════

const managedPanes = new Map<string, ManagedPane>();
const aliasOrder: string[] = [];

const recordAlias = (alias: string, paneId: string, workspaceId: string) => {
  managedPanes.set(alias, { paneId, workspaceId });
  const idx = aliasOrder.indexOf(alias);
  if (idx !== -1) {
    aliasOrder.splice(idx, 1);
  }
  aliasOrder.push(alias);
};

const forgetAlias = (alias: string) => {
  managedPanes.delete(alias);
  const idx = aliasOrder.indexOf(alias);
  if (idx !== -1) {
    aliasOrder.splice(idx, 1);
  }
};

const getPaneInfo = async (
  pi: ExtensionAPI,
  paneId: string,
  signal?: AbortSignal,
): Promise<PaneInfo | null> => {
  try {
    return await execHerdrJson<PaneInfo>(pi, ['pane', 'get', paneId], signal);
  } catch {
    return null;
  }
};

const requirePaneRef = async (
  pi: ExtensionAPI,
  ref: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ pane: PaneInfo; alias?: string }> => {
  const hadAlias = managedPanes.has(ref);

  // Check alias
  const managed = managedPanes.get(ref);
  if (managed && managed.workspaceId === workspaceId) {
    const pane = await getPaneInfo(pi, managed.paneId, signal);
    if (pane) {
      return { pane, alias: ref };
    }
    forgetAlias(ref);
    throw new Error(`Pane alias '${ref}' no longer points to a live pane.`);
  }

  if (hadAlias) {
    throw new Error(`Pane alias '${ref}' workspace mismatch.`);
  }

  // Check direct pane ID
  const pane = await getPaneInfo(pi, ref, signal);
  if (pane && pane.workspace_id === workspaceId) {
    const alias = [...managedPanes].find(([, m]) => m.paneId === pane.pane_id)?.[0];
    return { pane, alias };
  }

  throw new Error(`Pane '${ref}' not found in current workspace.`);
};

const getCurrentPane = async (pi: ExtensionAPI, signal?: AbortSignal): Promise<PaneInfo> => {
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) {
    throw new Error('Not running inside herdr');
  }
  return execHerdrJson<PaneInfo>(pi, ['pane', 'get', paneId], signal);
};

const getWorkspacePanes = async (
  pi: ExtensionAPI,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<PaneInfo[]> =>
  execHerdrJson<PaneInfo[]>(pi, ['pane', 'list', '--workspace', workspaceId], signal);

const getWorkspaceTabs = async (
  pi: ExtensionAPI,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<TabInfo[]> =>
  execHerdrJson<TabInfo[]>(pi, ['tab', 'list', '--workspace', workspaceId], signal);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// WAIT_AGENT — poll herdr's native agent status detection
// ═══════════════════════════════════════════════════════════════════════════

const waitAgent = async (
  pi: ExtensionAPI,
  options: {
    paneRefs: string[];
    statuses: AgentStatus[];
    mode: 'all' | 'any';
    timeoutMs?: number;
    signal?: AbortSignal;
    workspaceId: string;
  },
): Promise<Array<{ pane: string; paneId: string; status: AgentStatus }>> => {
  const { paneRefs, statuses, mode, timeoutMs, signal, workspaceId } = options;
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;

  const resolved: Array<{ pane: PaneInfo; ref: string }> = [];
  for (const ref of paneRefs) {
    if (signal?.aborted) {
      throw new Error('wait_agent canceled');
    }
    const r = await requirePaneRef(pi, ref, workspaceId, signal);
    resolved.push({ pane: r.pane, ref: r.alias ?? ref });
  }

  while (true) {
    if (signal?.aborted) {
      throw new Error('wait_agent canceled');
    }
    if (deadline && Date.now() >= deadline) {
      throw new Error('wait_agent timed out');
    }

    const snapshot: Array<{ pane: string; paneId: string; status: AgentStatus }> = [];
    for (const r of resolved) {
      const info = await getPaneInfo(pi, r.pane.pane_id, signal);
      if (!info) {
        throw new Error(`Pane '${r.ref}' no longer exists`);
      }
      snapshot.push({ pane: r.ref, paneId: info.pane_id, status: info.agent_status });
    }

    const satisfied =
      mode === 'all'
        ? snapshot.every((s) => statuses.includes(s.status))
        : snapshot.some((s) => statuses.includes(s.status));

    if (satisfied) {
      return snapshot;
    }
    await sleep(250);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DEV SERVICE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

type AikamiMode = 'emulator' | 'staging' | 'production';

type ServiceDef = {
  name: string;
  key: string;
  command: string;
  cwd: string;
  getReadyPort?: (mode: AikamiMode) => number;
  readyPath?: string;
};

const makeServices = (): Record<string, ServiceDef> => ({
  firebase: {
    name: 'firebase',
    key: 'firebase',
    command: 'bun run emulate',
    cwd: 'apps/backend/firebase',
    getReadyPort: () => 9098,
  },
  client: {
    name: 'client',
    key: 'client',
    command: 'bun run dev',
    cwd: 'apps/frontend/client',
    getReadyPort: () => 5274,
    readyPath: '/',
  },
  image: {
    name: 'image',
    key: 'image',
    command: 'bun run dev:docker',
    cwd: 'apps/backend/image',
    getReadyPort: () => 8188,
    readyPath: '/',
  },
  text: {
    name: 'text',
    key: 'text',
    command: 'bun run dev:docker',
    cwd: 'apps/backend/text',
    getReadyPort: () => 11434,
    readyPath: '/',
  },
  voice: {
    name: 'voice',
    key: 'voice',
    command: 'bun run dev:docker',
    cwd: 'apps/backend/voice',
    getReadyPort: () => 8089,
    readyPath: '/',
  },
  'preview-client': {
    name: 'preview-client',
    key: 'preview-client',
    command: 'bun run scripts/src/lib/ops/preview_client.ts',
    cwd: '.',
  },
});

const SERVICES = makeServices();
const ALL_SERVICES = Object.keys(SERVICES);

const getMode = (): AikamiMode => {
  const env = process.env.AIKAMI_MODE as string | undefined;
  return env === 'staging' || env === 'production' ? env : 'emulator';
};

const workspaceName = (): string => `aikami-${getMode()}`;

const wrapCommand = (command: string): string =>
  `direnv exec . bash -c '${command}; echo; echo "=== Stopped. Press Enter to close ==="; read'`;

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  const herdrEnv = process.env.HERDR_ENV;
  const ownPaneId = process.env.HERDR_PANE_ID;

  if (herdrEnv && ownPaneId) {
    // ───────────────────────────────────────────────────────────
    // TOOL: herdr — full pane orchestration
    // ───────────────────────────────────────────────────────────

    pi.registerTool({
      name: 'herdr',
      label: 'herdr',
      description:
        'Herdr-native pane orchestration. Actions: list, workspace_list, tab_list, ' +
        'pane_split, run, read, watch, wait_agent, send, stop, focus.',
      promptGuidelines: [
        'Use `herdr` run for long-running processes in other panes instead of `bash`.',
        'Use `wait_agent` only for panes running recognized coding agents (pi, claude, etc).',
        'Use `watch` for normal command output readiness (servers, tests, builds).',
        'Pane actions target pane aliases or real pane ids, not tab ids.',
        'For agent panes: background finished → `done`, focused finished → `idle`.',
        'Use `pane_split` (default: right from agent pane) or `tab_create` to establish targets.',
      ],
      parameters: Type.Object({
        action: Type.String({
          enum: [
            'list',
            'workspace_list',
            'workspace_create',
            'tab_list',
            'tab_create',
            'focus',
            'pane_split',
            'run',
            'read',
            'watch',
            'wait_agent',
            'send',
            'stop',
          ],
        }),
        pane: Type.Optional(Type.String({ description: 'Pane alias or pane id' })),
        panes: Type.Optional(
          Type.Array(Type.String(), { description: 'Pane aliases/ids for multi-wait' }),
        ),
        workspace: Type.Optional(Type.String({ description: 'Workspace id' })),
        tab: Type.Optional(Type.String({ description: 'Tab id' })),
        label: Type.Optional(Type.String()),
        newPane: Type.Optional(Type.String({ description: 'Alias for new pane' })),
        direction: Type.Optional(Type.String({ enum: ['right', 'down'], default: 'right' })),
        command: Type.Optional(Type.String()),
        match: Type.Optional(Type.String()),
        regex: Type.Optional(Type.Boolean()),
        status: Type.Optional(
          Type.String({ enum: ['idle', 'working', 'blocked', 'done', 'unknown'] }),
        ),
        statuses: Type.Optional(
          Type.Array(Type.String(), { description: 'Accepted statuses for multi-wait' }),
        ),
        mode: Type.Optional(Type.String({ enum: ['all', 'any'], default: 'all' })),
        timeout: Type.Optional(Type.Number()),
        lines: Type.Optional(Type.Number()),
        source: Type.Optional(
          Type.String({ enum: ['visible', 'recent', 'recent-unwrapped'], default: 'recent' }),
        ),
        raw: Type.Optional(Type.Boolean()),
        text: Type.Optional(Type.String()),
        keys: Type.Optional(Type.String()),
        cwd: Type.Optional(Type.String()),
        focus: Type.Optional(Type.Boolean()),
      }),

      async execute(_id, params, signal, _onUpdate, _ctx) {
        const currentPane = await getCurrentPane(pi, signal);
        const workspaceId = currentPane.workspace_id;
        const currentPaneId = currentPane.pane_id;

        const {
          action,
          pane,
          panes,
          workspace,
          tab,
          label,
          newPane,
          direction,
          command,
          match,
          regex,
          status,
          statuses,
          mode,
          timeout,
          lines,
          source,
          text,
          keys,
          cwd,
          focus,
        } = params;

        switch (action) {
          // ── list ────────────────────────────────────────
          case 'list': {
            const panes = await getWorkspacePanes(pi, workspaceId, signal);
            const aliasByPaneId = new Map<string, string>();
            for (const [a, m] of managedPanes) {
              if (m.workspaceId === workspaceId) {
                aliasByPaneId.set(m.paneId, a);
              }
            }

            const lines_ = panes.map((p) => {
              const alias = aliasByPaneId.get(p.pane_id);
              const name = alias ?? p.pane_id;
              const flags = [p.pane_id === currentPaneId ? 'current' : '', p.agent, p.agent_status]
                .filter(Boolean)
                .join(', ');
              return `${name} [${p.pane_id}]${flags ? ` (${flags})` : ''}`;
            });
            return {
              content: [{ type: 'text', text: lines_.join('\n') || 'No panes' }],
              details: {},
            };
          }

          // ── workspace_list ──────────────────────────────
          case 'workspace_list': {
            const ws = await execHerdrJson<WorkspaceInfo[]>(pi, ['workspace', 'list'], signal);
            const text = ws
              .map((w) => `${w.label} [${w.workspace_id}]${w.focused ? ' (focused)' : ''}`)
              .join('\n');
            return { content: [{ type: 'text', text: text || 'No workspaces' }], details: {} };
          }

          // ── workspace_create ────────────────────────────
          case 'workspace_create': {
            const args = ['workspace', 'create'];
            if (cwd) {
              args.push('--cwd', cwd);
            }
            if (label) {
              args.push('--label', label);
            }
            if (focus !== true) {
              args.push('--no-focus');
            }
            const ws = await execHerdrJson<WorkspaceInfo>(pi, args, signal);
            return {
              content: [
                { type: 'text', text: `Created workspace '${ws.label}' (${ws.workspace_id})` },
              ],
              details: {},
            };
          }

          // ── tab_list ────────────────────────────────────
          case 'tab_list': {
            const wsId = (workspace as string) ?? workspaceId;
            const tabs = await getWorkspaceTabs(pi, wsId, signal);
            const text = tabs
              .map((t) => `${t.label} [${t.tab_id}]${t.focused ? ' (focused)' : ''}`)
              .join('\n');
            return { content: [{ type: 'text', text: text || 'No tabs' }], details: {} };
          }

          // ── tab_create ──────────────────────────────────
          case 'tab_create': {
            const wsId = (workspace as string) ?? workspaceId;
            const args = ['tab', 'create', '--workspace', wsId];
            if (cwd) {
              args.push('--cwd', cwd);
            }
            if (label) {
              args.push('--label', label);
            }
            if (focus !== true) {
              args.push('--no-focus');
            }
            const tab = await execHerdrJson<TabInfo>(pi, args, signal);
            return {
              content: [{ type: 'text', text: `Created tab '${tab.label}' (${tab.tab_id})` }],
              details: {},
            };
          }

          // ── focus ───────────────────────────────────────
          case 'focus': {
            if (tab) {
              const t = await execHerdrJson<TabInfo>(pi, ['tab', 'focus', tab as string], signal);
              return { content: [{ type: 'text', text: `Focused tab '${t.label}'` }], details: {} };
            }
            if (workspace) {
              const w = await execHerdrJson<WorkspaceInfo>(
                pi,
                ['workspace', 'focus', workspace as string],
                signal,
              );
              return {
                content: [{ type: 'text', text: `Focused workspace '${w.label}'` }],
                details: {},
              };
            }
            if (pane) {
              const r = await requirePaneRef(pi, pane as string, workspaceId, signal);
              const t = await execHerdrJson<TabInfo>(pi, ['tab', 'focus', r.pane.tab_id], signal);
              return {
                content: [
                  { type: 'text', text: `Focused tab '${t.label}' for pane '${r.pane.pane_id}'` },
                ],
                details: {},
              };
            }
            throw new Error("'workspace', 'tab', or 'pane' required for focus");
          }

          // ── pane_split ──────────────────────────────────
          case 'pane_split': {
            const srcRef = (pane as string) ?? currentPaneId;
            const dir = (direction as string) ?? 'right';
            const src = await requirePaneRef(pi, srcRef, workspaceId, signal);
            const args = ['pane', 'split', src.pane.pane_id, '--direction', dir];
            if (cwd) {
              args.push('--cwd', cwd);
            }
            if (focus !== true) {
              args.push('--no-focus');
            }
            const split = await execHerdrJson<PaneInfo>(pi, args, signal);
            if (newPane) {
              recordAlias(newPane as string, split.pane_id, split.workspace_id);
            }
            return {
              content: [{ type: 'text', text: `Split pane: ${split.pane_id}` }],
              details: {},
            };
          }

          // ── run ─────────────────────────────────────────
          case 'run': {
            if (!pane || !command) {
              throw new Error("'pane' and 'command' required for run");
            }
            const r = await requirePaneRef(pi, pane as string, workspaceId, signal);
            await execHerdr(pi, ['pane', 'run', r.pane.pane_id, command as string], signal);
            await sleep(800);
            const output = await execHerdrText(
              pi,
              [
                'pane',
                'read',
                r.pane.pane_id,
                '--source',
                (source as string) ?? 'recent',
                '--lines',
                String(lines ?? 20),
              ],
              signal,
            );
            return {
              content: [{ type: 'text', text: `Started in ${r.alias ?? pane}:\n\n${output}` }],
              details: {},
            };
          }

          // ── read ────────────────────────────────────────
          case 'read': {
            if (!pane) {
              throw new Error("'pane' required for read");
            }
            const r = await requirePaneRef(pi, pane as string, workspaceId, signal);
            const output = await execHerdrText(
              pi,
              [
                'pane',
                'read',
                r.pane.pane_id,
                '--source',
                (source as string) ?? 'recent',
                '--lines',
                String(lines ?? 50),
              ],
              signal,
            );
            return { content: [{ type: 'text', text: output }], details: {} };
          }

          // ── watch ───────────────────────────────────────
          case 'watch': {
            if (!pane || !match) {
              throw new Error("'pane' and 'match' required for watch");
            }
            const r = await requirePaneRef(pi, pane as string, workspaceId, signal);
            const args = ['wait', 'output', r.pane.pane_id, '--match', match as string];
            if (regex) {
              args.push('--regex');
            }
            if (timeout != null) {
              args.push('--timeout', String(timeout));
            }
            if (source) {
              args.push('--source', source as string);
            }
            if (lines != null) {
              args.push('--lines', String(lines));
            }
            const result = await execHerdrJson<any>(pi, args, signal);
            return {
              content: [{ type: 'text', text: `Matched: ${result.matched_line}` }],
              details: {},
            };
          }

          // ── wait_agent ──────────────────────────────────
          case 'wait_agent': {
            const refs = (panes as string[])?.length
              ? (panes as string[])
              : pane
                ? [pane as string]
                : [];
            const sts = (statuses as string[])?.length
              ? (statuses as string[])
              : status
                ? [status as string]
                : [];
            if (!refs.length) {
              throw new Error("'pane' or 'panes' required");
            }
            if (!sts.length) {
              throw new Error("'status' or 'statuses' required");
            }

            const snapshot = await waitAgent(pi, {
              paneRefs: refs,
              statuses: sts as AgentStatus[],
              mode: (mode as 'all' | 'any') ?? 'all',
              timeoutMs: timeout,
              signal,
              workspaceId,
            });

            const summary = snapshot.map((s) => `${s.pane}=${s.status}`).join(', ');
            return {
              content: [{ type: 'text', text: `wait_agent satisfied: ${summary}` }],
              details: {},
            };
          }

          // ── send ────────────────────────────────────────
          case 'send': {
            if (!pane) {
              throw new Error("'pane' required for send");
            }
            if (!text && !keys) {
              throw new Error("'text' or 'keys' required");
            }
            const r = await requirePaneRef(pi, pane as string, workspaceId, signal);
            if (text) {
              await execHerdr(pi, ['pane', 'send-text', r.pane.pane_id, text as string], signal);
            }
            if (keys) {
              const k = (keys as string).split(/\s+/).filter(Boolean);
              await execHerdr(pi, ['pane', 'send-keys', r.pane.pane_id, ...k], signal);
            }
            return { content: [{ type: 'text', text: `Sent to ${r.alias ?? pane}` }], details: {} };
          }

          // ── stop ────────────────────────────────────────
          case 'stop': {
            if (!pane) {
              throw new Error("'pane' required for stop");
            }
            const r = await requirePaneRef(pi, pane as string, workspaceId, signal);
            if (r.pane.pane_id === currentPaneId) {
              throw new Error('Cannot close own pane');
            }
            await execHerdr(pi, ['pane', 'close', r.pane.pane_id], signal);
            if (r.alias) {
              forgetAlias(r.alias);
            }
            return {
              content: [{ type: 'text', text: `Closed pane ${r.alias ?? pane}` }],
              details: {},
            };
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // TOOL: herdr_session — aikami dev service lifecycle
  // ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: 'herdr_session',
    label: 'Herdr: Manage Dev Services',
    description:
      'Manage Aikami dev services (firebase, client, image, text, voice, preview-client) via herdr. ' +
      'Services survive pi restarts. Workspace naming: aikami-{mode}.',
    promptGuidelines: [
      'Use herdr_session start <service> to start firebase, client, image, text, voice, or preview-client.',
      'Use herdr_session read <service> to capture log output from a running service.',
      'Use herdr_session list to see all managed services and their status.',
      'Use herdr_session stop <service> to cleanly stop a service.',
    ],
    parameters: Type.Object({
      action: Type.String({ enum: ['start', 'stop', 'status', 'read', 'list'] }),
      service: Type.Optional(Type.String({ enum: ALL_SERVICES })),
      lines: Type.Optional(Type.Number({ default: 100 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const ws = workspaceName();
      const mode = getMode();
      const svc = params.service ? SERVICES[params.service] : undefined;

      // Helpers
      const findWs = async (): Promise<string | null> => {
        try {
          const list = await execHerdrJson<WorkspaceInfo[]>(pi, ['workspace', 'list'], signal);
          const w = list.find((w) => w.label === ws);
          return w?.workspace_id ?? null;
        } catch {
          return null;
        }
      };

      const getTabs = async (wsId: string): Promise<string[]> => {
        try {
          const tabs = await execHerdrJson<TabInfo[]>(
            pi,
            ['tab', 'list', '--workspace', wsId],
            signal,
          );
          return tabs.map((t) => t.label);
        } catch {
          return [];
        }
      };

      const isReady = async (s: ServiceDef): Promise<boolean> => {
        if (!s.getReadyPort) {
          return true;
        }
        const path = s.readyPath ?? '/';
        const port = s.getReadyPort(mode);
        try {
          const r = await pi.exec('bash', [
            '-c',
            `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}${path} 2>/dev/null || echo 000`,
          ]);
          const code = Number(r.stdout?.trim() ?? '0');
          return code >= 200 && code < 500;
        } catch {
          return false;
        }
      };

      // ── list ──────────────────────────────────────────────
      if (params.action === 'list') {
        const wsId = await findWs();
        const tabNames = wsId ? await getTabs(wsId) : [];
        const parts: string[] = ['**Aikami Dev Services**\n'];
        for (const s of Object.values(SERVICES)) {
          if (tabNames.includes(s.name)) {
            const ready = await isReady(s);
            const port = s.getReadyPort?.(mode);
            parts.push(`${ready ? '✅' : '⏳'} **${s.key}** (${ws})${port ? ` — :${port}` : ''}`);
          } else {
            parts.push(`⏸️ **${s.key}** — not running`);
          }
        }
        parts.push(`\nAttach: \`herdr session attach default\``);
        return { content: [{ type: 'text', text: parts.join('\n') }], details: {} };
      }

      if (!svc) {
        return {
          content: [{ type: 'text', text: `Service required. Valid: ${ALL_SERVICES.join(', ')}` }],
          isError: true,
          details: {},
        };
      }

      // ── start ─────────────────────────────────────────────
      if (params.action === 'start') {
        const wsId = await findWs();
        const tabNames = wsId ? await getTabs(wsId) : [];

        if (tabNames.includes(svc.name) && (await isReady(svc))) {
          const port = svc.getReadyPort?.(mode);
          return {
            content: [
              {
                type: 'text',
                text: `✅ ${svc.name} already running${port ? ` (port :${port})` : ''}`,
              },
            ],
            details: {},
          };
        }

        _onUpdate?.({ content: [{ type: 'text', text: `Starting ${svc.name}...` }], details: {} });

        const svcCwd = `${ctx.cwd}/${svc.cwd}`;

        // Recreate tab if exists but not ready
        if (wsId && tabNames.includes(svc.name)) {
          const tabs = await execHerdrJson<TabInfo[]>(
            pi,
            ['tab', 'list', '--workspace', wsId],
            signal,
          );
          const tab = tabs.find((t) => t.label === svc.name);
          if (tab) {
            await execHerdr(pi, ['tab', 'close', tab.tab_id], signal);
            await sleep(500);
          }
        }

        if (!wsId) {
          const create = await execHerdrJson<{ workspace: WorkspaceInfo }>(
            pi,
            ['workspace', 'create', '--cwd', svcCwd, '--label', ws, '--no-focus'],
            signal,
          );
          const newWsId = create.workspace.workspace_id;
          const panes = await getWorkspacePanes(pi, newWsId, signal);
          const rootPane = panes[0];
          if (rootPane) {
            await execHerdr(pi, ['tab', 'rename', `${newWsId}:1`, svc.name], signal);
            await execHerdr(
              pi,
              ['pane', 'run', rootPane.pane_id, wrapCommand(svc.command)],
              signal,
            );
          }
        } else {
          const tab = await execHerdrJson<TabInfo>(
            pi,
            [
              'tab',
              'create',
              '--workspace',
              wsId,
              '--cwd',
              svcCwd,
              '--label',
              svc.name,
              '--no-focus',
            ],
            signal,
          );
          const panes = await getWorkspacePanes(pi, wsId, signal);
          const pane = panes.find((p) => p.tab_id === tab.tab_id);
          if (pane) {
            await execHerdr(pi, ['pane', 'run', pane.pane_id, wrapCommand(svc.command)], signal);
          }
        }

        // Wait for readiness
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          if (signal?.aborted) {
            break;
          }
          await sleep(2000);
          ready = await isReady(svc);
        }

        if (!ready) {
          return {
            content: [
              { type: 'text', text: `⚠️ ${svc.name} started but not responding after 60s.` },
            ],
            isError: true,
            details: {},
          };
        }

        const port = svc.getReadyPort?.(mode);
        return {
          content: [
            { type: 'text', text: `✅ ${svc.name} running${port ? ` (port :${port})` : ''}` },
          ],
          details: {},
        };
      }

      // ── stop ──────────────────────────────────────────────
      if (params.action === 'stop') {
        const wsId = await findWs();
        if (!wsId) {
          return { content: [{ type: 'text', text: `Workspace ${ws} not running.` }], details: {} };
        }

        const tabNames = await getTabs(wsId);
        if (!tabNames.includes(svc.name)) {
          return { content: [{ type: 'text', text: `${svc.name} not running.` }], details: {} };
        }

        if (tabNames.length === 1) {
          await execHerdr(pi, ['workspace', 'close', wsId], signal);
        } else {
          const tabs = await execHerdrJson<TabInfo[]>(
            pi,
            ['tab', 'list', '--workspace', wsId],
            signal,
          );
          const tab = tabs.find((t) => t.label === svc.name);
          if (tab) {
            await execHerdr(pi, ['tab', 'close', tab.tab_id], signal);
          }
        }

        return { content: [{ type: 'text', text: `🛑 Stopped ${svc.name}` }], details: {} };
      }

      // ── status ────────────────────────────────────────────
      if (params.action === 'status') {
        const wsId = await findWs();
        if (!wsId) {
          return { content: [{ type: 'text', text: `⏸️ ${svc.name} — not running` }], details: {} };
        }

        const tabNames = await getTabs(wsId);
        if (!tabNames.includes(svc.name)) {
          return { content: [{ type: 'text', text: `⏸️ ${svc.name} — not running` }], details: {} };
        }

        const ready = await isReady(svc);
        const port = svc.getReadyPort?.(mode);
        return {
          content: [
            {
              type: 'text',
              text: `${ready ? '✅' : '❌'} ${svc.name}${port ? ` :${port} ${ready ? 'responding' : 'NOT responding'}` : ''}`,
            },
          ],
          details: {},
        };
      }

      // ── read ──────────────────────────────────────────────
      if (params.action === 'read') {
        const wsId = await findWs();
        if (!wsId) {
          return { content: [{ type: 'text', text: `Workspace ${ws} not running.` }], details: {} };
        }

        const panes = await getWorkspacePanes(pi, wsId, signal);
        const tabs = await getWorkspaceTabs(pi, wsId, signal);
        const tab = tabs.find((t) => t.label === svc.name);
        if (!tab) {
          return { content: [{ type: 'text', text: `Tab ${svc.name} not found` }], details: {} };
        }

        const pane = panes.find((p) => p.tab_id === tab.tab_id);
        if (!pane) {
          return { content: [{ type: 'text', text: `No pane for ${svc.name}` }], details: {} };
        }

        const output = await execHerdrText(
          pi,
          [
            'pane',
            'read',
            pane.pane_id,
            '--source',
            'recent',
            '--lines',
            String(params.lines ?? 100),
          ],
          signal,
        );

        return {
          content: [
            {
              type: 'text',
              text: `**${svc.name}** (last ${params.lines ?? 100} lines):\n\n\`\`\`\n${output}\n\`\`\``,
            },
          ],
          details: {},
        };
      }

      return {
        content: [{ type: 'text', text: `Unknown action: ${params.action}` }],
        isError: true,
        details: {},
      };
    },
  });
}
