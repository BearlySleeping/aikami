// .pi/extensions/herdr_orchestrator.ts
//
// Consolidated herdr extension for pi — pane orchestration, agent wait, dev
// service management slash commands.
//
// Dev service lifecycle delegates to scripts/src/lib/herdr/session.ts
// (single source of truth shared with CLI scripts and blackbox tests).
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

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  type AikamiMode,
  ALL_SERVICES,
  type DevService,
  findWorkspace,
  getWorkspaceTabNames,
  isPortReady,
  listServices,
  restartServices,
  SERVICE_DEFS,
  startServices,
  stopServices,
} from '../../scripts/src/lib/herdr/session';

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
  const result = await pi.exec('herdr', args, { signal });
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
): Promise<PaneInfo[]> => {
  const result = await execHerdrJson<{ panes: PaneInfo[] }>(
    pi,
    ['pane', 'list', '--workspace', workspaceId],
    signal,
  );
  return result.panes ?? [];
};

const getWorkspaceTabs = async (
  pi: ExtensionAPI,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<TabInfo[]> => {
  const result = await execHerdrJson<{ tabs: TabInfo[] }>(
    pi,
    ['tab', 'list', '--workspace', workspaceId],
    signal,
  );
  return result.tabs ?? [];
};

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
// EXTENSION
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  const herdrEnv = process.env.HERDR_ENV;
  const ownPaneId = process.env.HERDR_PANE_ID;

  // ── Runtime mode ────────────────────────────────────────
  const mode: AikamiMode = (() => {
    const env = process.env.AIKAMI_MODE as string | undefined;
    return env === 'staging' || env === 'production' ? env : 'emulator';
  })();
  const workspaceLabel = `aikami-${mode}`;

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
        timeout: Type.Optional(
          Type.Number({ description: 'Timeout in milliseconds (default: no timeout)' }),
        ),
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
          mode: waitMode,
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
            const result = await execHerdrJson<{ matched_line: string }>(pi, args, signal);
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
              mode: (waitMode as 'all' | 'any') ?? 'all',
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
      'Use herdr_session stop <service> to cleanly stop a service.',
      'Use herdr_session restart <service> to stop+start (e.g. restart client after the coder added new routes).',
      'Use herdr_session read <service> to capture log output from a running service.',
      'Use herdr_session list to see all managed services and their status.',
    ],
    parameters: Type.Object({
      action: Type.String({ enum: ['start', 'stop', 'restart', 'status', 'read', 'list'] }),
      service: Type.Optional(Type.String({ enum: [...ALL_SERVICES] })),
      lines: Type.Optional(Type.Number({ default: 100 })),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const svc = params.service ? SERVICE_DEFS[params.service as DevService] : undefined;

      // ── Dispatch map ──────────────────────────────────────

      const handlers = {
        // ── list ──────────────────────────────────────────
        list: async () => {
          try {
            const sessions = await listServices(mode);
            if (sessions.length === 0) {
              return {
                content: [{ type: 'text', text: `No aikami-${mode} workspace running.` }],
                details: {},
              };
            }

            const lines: string[] = [`**Aikami Dev Services** (${workspaceLabel})\n`];
            for (const session of sessions) {
              for (const svcStatus of session.services) {
                if (svcStatus.running) {
                  const icon = svcStatus.portOpen ? '✅' : '⏳';
                  const port = svcStatus.readyPort ? ` — :${svcStatus.readyPort}` : '';
                  lines.push(`${icon} **${svcStatus.name}**${port}`);
                } else {
                  lines.push(`⏸️ **${svcStatus.name}** — not running`);
                }
              }
            }
            lines.push(`\nAttach: \`herdr session attach default\``);
            return { content: [{ type: 'text', text: lines.join('\n') }], details: {} };
          } catch (e) {
            return {
              content: [{ type: 'text', text: `Failed to list services: ${(e as Error).message}` }],
              isError: true,
              details: {},
            };
          }
        },

        // ── start ──────────────────────────────────────────
        start: async () => {
          if (!svc) {
            return {
              content: [
                { type: 'text', text: `Service required. Valid: ${ALL_SERVICES.join(', ')}` },
              ],
              isError: true,
              details: {},
            };
          }

          // Check if already running
          const wsId = await findWorkspace(workspaceLabel);
          if (wsId) {
            const tabNames = await getWorkspaceTabNames(wsId);
            if (
              tabNames.includes(svc.name) &&
              svc.readyPort &&
              (await isPortReady(svc.readyPort))
            ) {
              return {
                content: [
                  { type: 'text', text: `✅ ${svc.name} already running (port :${svc.readyPort})` },
                ],
                details: {},
              };
            }
          }

          _onUpdate?.({
            content: [{ type: 'text', text: `Starting ${svc.name}...` }],
            details: {},
          });

          try {
            await startServices({
              mode,
              services: [params.service as DevService],
              projectRoot: process.cwd(),
            });
            const port = svc.readyPort;
            return {
              content: [
                { type: 'text', text: `✅ ${svc.name} running${port ? ` (port :${port})` : ''}` },
              ],
              details: {},
            };
          } catch (e) {
            return {
              content: [
                { type: 'text', text: `⚠️ ${svc.name} failed to start: ${(e as Error).message}` },
              ],
              isError: true,
              details: {},
            };
          }
        },

        // ── restart ────────────────────────────────────────
        restart: async () => {
          if (!svc) {
            return {
              content: [
                { type: 'text', text: `Service required. Valid: ${ALL_SERVICES.join(', ')}` },
              ],
              isError: true,
              details: {},
            };
          }

          _onUpdate?.({
            content: [{ type: 'text', text: `Restarting ${svc.name}...` }],
            details: {},
          });

          try {
            await restartServices({
              mode,
              services: [params.service as DevService],
              projectRoot: process.cwd(),
            });
            const port = svc.readyPort;
            return {
              content: [
                { type: 'text', text: `✅ ${svc.name} restarted${port ? ` (port :${port})` : ''}` },
              ],
              details: {},
            };
          } catch (e) {
            return {
              content: [
                { type: 'text', text: `⚠️ ${svc.name} restart failed: ${(e as Error).message}` },
              ],
              isError: true,
              details: {},
            };
          }
        },

        // ── stop ───────────────────────────────────────────
        stop: async () => {
          if (!svc) {
            return {
              content: [
                { type: 'text', text: `Service required. Valid: ${ALL_SERVICES.join(', ')}` },
              ],
              isError: true,
              details: {},
            };
          }

          const wsId = await findWorkspace(workspaceLabel);
          if (!wsId) {
            return { content: [{ type: 'text', text: `${svc.name} not running.` }], details: {} };
          }

          const tabNames = await getWorkspaceTabNames(wsId);
          if (!tabNames.includes(svc.name)) {
            return { content: [{ type: 'text', text: `${svc.name} not running.` }], details: {} };
          }

          try {
            await stopServices({ mode, services: [params.service as DevService] });
            return { content: [{ type: 'text', text: `🛑 Stopped ${svc.name}` }], details: {} };
          } catch (e) {
            return {
              content: [
                { type: 'text', text: `Failed to stop ${svc.name}: ${(e as Error).message}` },
              ],
              isError: true,
              details: {},
            };
          }
        },

        // ── status ─────────────────────────────────────────
        status: async () => {
          if (!svc) {
            return {
              content: [
                { type: 'text', text: `Service required. Valid: ${ALL_SERVICES.join(', ')}` },
              ],
              isError: true,
              details: {},
            };
          }

          const wsId = await findWorkspace(workspaceLabel);
          if (!wsId) {
            return {
              content: [{ type: 'text', text: `⏸️ ${svc.name} — not running` }],
              details: {},
            };
          }

          const tabNames = await getWorkspaceTabNames(wsId);
          if (!tabNames.includes(svc.name)) {
            return {
              content: [{ type: 'text', text: `⏸️ ${svc.name} — not running` }],
              details: {},
            };
          }

          const ready = svc.readyPort ? await isPortReady(svc.readyPort) : true;
          const port = svc.readyPort;
          return {
            content: [
              {
                type: 'text',
                text: `${ready ? '✅' : '❌'} ${svc.name}${port ? ` :${port} ${ready ? 'responding' : 'NOT responding'}` : ''}`,
              },
            ],
            details: {},
          };
        },

        // ── read ───────────────────────────────────────────
        read: async () => {
          if (!svc) {
            return {
              content: [
                { type: 'text', text: `Service required. Valid: ${ALL_SERVICES.join(', ')}` },
              ],
              isError: true,
              details: {},
            };
          }

          const wsId = await findWorkspace(workspaceLabel);
          if (!wsId) {
            return {
              content: [{ type: 'text', text: `Workspace ${workspaceLabel} not running.` }],
              details: {},
            };
          }

          // Pane-level read: use herdr CLI directly
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
        },
      };

      const handler = handlers[params.action as keyof typeof handlers];
      if (!handler) {
        return {
          content: [{ type: 'text', text: `Unknown action: ${params.action}` }],
          isError: true,
          details: {},
        };
      }
      return handler() as unknown as import('@earendil-works/pi-agent-core').AgentToolResult<
        Record<string, unknown>
      >;
    },
  });
}
