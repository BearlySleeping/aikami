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
import { contractPortOffset } from '../../packages/shared/constants/src/index.ts';
import { runGit, sanitizeBranchName } from '../../scripts/src/lib/agents/git_worktree';
import {
  type AikamiMode,
  currentContractId,
  type DevService,
  findWorkspace,
  getWorkspaceTabNames,
  isPortReady,
  KNOWN_SERVICES,
  listServices,
  resolveReadyPort,
  restartServices,
  SERVICE_DEFS,
  startServices,
  stopServices,
} from '../../scripts/src/lib/herdr/session';
import {
  openPullRequest,
  publishWorktree,
  worktreeRepoRoot,
} from '../../scripts/src/lib/herdr/worktree';
import { runCommand } from './lib/process_runner.ts';

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

const HERDR_TIMEOUT_MS = 600_000; // 10 min safety net; herdr CLI waits are bounded by their own --timeout args

const execHerdr = async (
  args: string[],
  signal?: AbortSignal,
  timeoutMs: number = HERDR_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const result = await runCommand('herdr', args, { signal, timeoutMs });
  if (signal?.aborted || result.killed) {
    throw new Error('Aborted');
  }
  // runCommand reports null when the process never started (e.g. herdr not on
  // PATH). Callers only branch on `code !== 0`, so map it to a non-zero value
  // rather than letting null silently read as success.
  return { code: result.code ?? -1, stdout: result.stdout, stderr: result.stderr };
};

const execHerdrJson = async <T>(args: string[], signal?: AbortSignal): Promise<T> => {
  const { code, stdout } = await execHerdr(args, signal);
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

const execHerdrText = async (args: string[], signal?: AbortSignal): Promise<string> => {
  const { stdout } = await execHerdr(args, signal);
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

const getPaneInfo = async (paneId: string, signal?: AbortSignal): Promise<PaneInfo | null> => {
  try {
    return await execHerdrJson<PaneInfo>(['pane', 'get', paneId], signal);
  } catch {
    return null;
  }
};

const requirePaneRef = async (
  ref: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ pane: PaneInfo; alias?: string }> => {
  const hadAlias = managedPanes.has(ref);

  // Check alias
  const managed = managedPanes.get(ref);
  if (managed && managed.workspaceId === workspaceId) {
    const pane = await getPaneInfo(managed.paneId, signal);
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
  const pane = await getPaneInfo(ref, signal);
  if (pane && pane.workspace_id === workspaceId) {
    const alias = [...managedPanes].find(([, m]) => m.paneId === pane.pane_id)?.[0];
    return { pane, alias };
  }

  throw new Error(`Pane '${ref}' not found in current workspace.`);
};

const getCurrentPane = async (signal?: AbortSignal): Promise<PaneInfo> => {
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) {
    throw new Error('Not running inside herdr');
  }
  return execHerdrJson<PaneInfo>(['pane', 'get', paneId], signal);
};

const getWorkspacePanes = async (
  workspaceId: string,
  signal?: AbortSignal,
): Promise<PaneInfo[]> => {
  const result = await execHerdrJson<{ panes: PaneInfo[] }>(
    ['pane', 'list', '--workspace', workspaceId],
    signal,
  );
  return result.panes ?? [];
};

const getWorkspaceTabs = async (workspaceId: string, signal?: AbortSignal): Promise<TabInfo[]> => {
  const result = await execHerdrJson<{ tabs: TabInfo[] }>(
    ['tab', 'list', '--workspace', workspaceId],
    signal,
  );
  return result.tabs ?? [];
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// WAIT_AGENT — poll herdr's native agent status detection
// ═══════════════════════════════════════════════════════════════════════════

const waitAgent = async (options: {
  paneRefs: string[];
  statuses: AgentStatus[];
  mode: 'all' | 'any';
  timeoutMs?: number;
  signal?: AbortSignal;
  workspaceId: string;
}): Promise<Array<{ pane: string; paneId: string; status: AgentStatus }>> => {
  const { paneRefs, statuses, mode, timeoutMs, signal, workspaceId } = options;
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;

  const resolved: Array<{ pane: PaneInfo; ref: string }> = [];
  for (const ref of paneRefs) {
    if (signal?.aborted) {
      throw new Error('wait_agent canceled');
    }
    const r = await requirePaneRef(ref, workspaceId, signal);
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
      const info = await getPaneInfo(r.pane.pane_id, signal);
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
  const workspaceLabel = (() => {
    // In contract pipeline, scope the workspace to the contract so
    // cleanup can terminate only that contract's services.
    const contractPath = process.env.CONTRACT_PIPELINE_CONTRACT_PATH;
    if (contractPath) {
      const m = contractPath.match(/(C-\d+|MIG-\d+)/);
      if (m?.[0]) {
        return `aikami-${mode}-${m[0]}`;
      }
    }
    return `aikami-${mode}`;
  })();

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
        const currentPane = await getCurrentPane(signal);
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
            const workspacePanes = await getWorkspacePanes(workspaceId, signal);
            const aliasByPaneId = new Map<string, string>();
            for (const [a, m] of managedPanes) {
              if (m.workspaceId === workspaceId) {
                aliasByPaneId.set(m.paneId, a);
              }
            }

            const lines_ = workspacePanes.map((p) => {
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
            const ws = await execHerdrJson<WorkspaceInfo[]>(['workspace', 'list'], signal);
            const wsText = ws
              .map((w) => `${w.label} [${w.workspace_id}]${w.focused ? ' (focused)' : ''}`)
              .join('\n');
            return { content: [{ type: 'text', text: wsText || 'No workspaces' }], details: {} };
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
            const ws = await execHerdrJson<WorkspaceInfo>(args, signal);
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
            const tabs = await getWorkspaceTabs(wsId, signal);
            const tabsText = tabs
              .map((t) => `${t.label} [${t.tab_id}]${t.focused ? ' (focused)' : ''}`)
              .join('\n');
            return { content: [{ type: 'text', text: tabsText || 'No tabs' }], details: {} };
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
            const newTab = await execHerdrJson<TabInfo>(args, signal);
            return {
              content: [{ type: 'text', text: `Created tab '${newTab.label}' (${newTab.tab_id})` }],
              details: {},
            };
          }

          // ── focus ───────────────────────────────────────
          case 'focus': {
            if (tab) {
              const t = await execHerdrJson<TabInfo>(['tab', 'focus', tab as string], signal);
              return { content: [{ type: 'text', text: `Focused tab '${t.label}'` }], details: {} };
            }
            if (workspace) {
              const w = await execHerdrJson<WorkspaceInfo>(
                ['workspace', 'focus', workspace as string],
                signal,
              );
              return {
                content: [{ type: 'text', text: `Focused workspace '${w.label}'` }],
                details: {},
              };
            }
            if (pane) {
              const r = await requirePaneRef(pane as string, workspaceId, signal);
              const t = await execHerdrJson<TabInfo>(['tab', 'focus', r.pane.tab_id], signal);
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
            const src = await requirePaneRef(srcRef, workspaceId, signal);
            const args = ['pane', 'split', src.pane.pane_id, '--direction', dir];
            if (cwd) {
              args.push('--cwd', cwd);
            }
            if (focus !== true) {
              args.push('--no-focus');
            }
            const split = await execHerdrJson<PaneInfo>(args, signal);
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
            const r = await requirePaneRef(pane as string, workspaceId, signal);
            await execHerdr(['pane', 'run', r.pane.pane_id, command as string], signal);
            await sleep(800);
            const output = await execHerdrText(
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
            const r = await requirePaneRef(pane as string, workspaceId, signal);
            const output = await execHerdrText(
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
            const r = await requirePaneRef(pane as string, workspaceId, signal);
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
            const result = await execHerdrJson<{ matched_line: string }>(args, signal);
            return {
              content: [{ type: 'text', text: `Matched: ${result.matched_line}` }],
              details: {},
            };
          }

          // ── wait_agent ──────────────────────────────────
          case 'wait_agent': {
            let refs: string[];
            if ((panes as string[])?.length) {
              refs = panes as string[];
            } else if (pane) {
              refs = [pane as string];
            } else {
              refs = [];
            }
            let sts: string[];
            if ((statuses as string[])?.length) {
              sts = statuses as string[];
            } else if (status) {
              sts = [status as string];
            } else {
              sts = [];
            }
            if (!refs.length) {
              throw new Error("'pane' or 'panes' required");
            }
            if (!sts.length) {
              throw new Error("'status' or 'statuses' required");
            }

            const snapshot = await waitAgent({
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
            const r = await requirePaneRef(pane as string, workspaceId, signal);
            if (text) {
              await execHerdr(['pane', 'send-text', r.pane.pane_id, text as string], signal);
            }
            if (keys) {
              const k = (keys as string).split(/\s+/).filter(Boolean);
              await execHerdr(['pane', 'send-keys', r.pane.pane_id, ...k], signal);
            }
            return { content: [{ type: 'text', text: `Sent to ${r.alias ?? pane}` }], details: {} };
          }

          // ── stop ────────────────────────────────────────
          case 'stop': {
            if (!pane) {
              throw new Error("'pane' required for stop");
            }
            const r = await requirePaneRef(pane as string, workspaceId, signal);
            if (r.pane.pane_id === currentPaneId) {
              throw new Error('Cannot close own pane');
            }
            await execHerdr(['pane', 'close', r.pane.pane_id], signal);
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
  // TOOL: task_pr — publish the current task worktree + open a PR
  // ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: 'task_pr',
    label: 'Task: Open PR from Worktree',
    description:
      'Publish the current herdr-native task worktree (commit all changes, push ' +
      'the branch, with remote-collision guard) and open a GitHub PR to the ' +
      'requested base branch (default: main). Run from inside a task worktree ' +
      '(bun herdr:task new <slug>) or pass an explicit checkoutPath.',
    parameters: Type.Object({
      checkoutPath: Type.Optional(
        Type.String({ description: 'Absolute worktree checkout path. Defaults to cwd.' }),
      ),
      baseBranch: Type.Optional(Type.String({ default: 'main' })),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      draft: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const checkoutPath = (params.checkoutPath as string | undefined) ?? ctx.cwd;
      const base = (params.baseBranch as string | undefined) ?? 'main';

      // Shared repo-root resolution (single implementation — worktree.ts).
      let repoRoot: string;
      let branch: string;
      try {
        repoRoot = worktreeRepoRoot(checkoutPath);
        branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: checkoutPath });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `❌ Could not resolve the task checkout \`${checkoutPath}\`: ${message}`,
            },
          ],
          details: { step: 'resolve_checkout', checkoutPath },
        };
      }

      const slug = sanitizeBranchName(branch.replace(/^task\//, '').replace(/^worktree\//, ''));
      const title = (params.title as string | undefined) ?? `Task: ${slug}`;

      // Publish (commit + push). If this fails nothing was pushed.
      let headBranch: string;
      let headCommit: string;
      try {
        ({ headBranch, headCommit } = await publishWorktree({
          checkoutPath,
          repoRoot,
          base,
          message: `Feat: ${slug}`,
          authorName: 'Pi Agent',
          authorEmail: 'agent@pi.internal',
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `❌ Publish failed (nothing was pushed): ${message}` }],
          details: { step: 'publish_worktree', checkoutPath, base },
        };
      }

      // Open the PR. The branch IS already pushed at this point — the caller
      // must not re-publish, only retry the PR step.
      let prUrl: string;
      let prNumber: string;
      try {
        ({ prUrl, prNumber } = await openPullRequest({
          headBranch,
          base,
          title,
          body: params.body as string | undefined,
          draft: (params.draft as boolean | undefined) ?? false,
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                `❌ Branch \`${headBranch}\` was pushed, but \`gh pr create\` failed: ${message}\n` +
                'Retry the PR step only; do not publish again.',
            },
          ],
          details: { step: 'open_pull_request', headBranch, headCommit, base },
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ **PR #${prNumber} opened** (branch \`${headBranch}\` @ \`${headCommit.slice(0, 7)}\`)`,
              `→ ${prUrl}`,
              '',
              'Merge it with gh_merge_pr when CI passes. The worktree is preserved.',
            ].join('\n'),
          },
        ],
        details: { headBranch, headCommit, prUrl, prNumber, base },
      };
    },
  });

  // ─────────────────────────────────────────────────────────────
  // TOOL: herdr_session — aikami dev service lifecycle
  // ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: 'herdr_session',
    label: 'Herdr: Manage Dev Services',
    description:
      'Manage Aikami dev services (firebase, client, image, text, voice, preview-client, site, preview-site) via herdr. ' +
      'Services survive pi restarts. Workspace naming: aikami-{mode}.',
    parameters: Type.Object({
      action: Type.String({ enum: ['start', 'stop', 'restart', 'status', 'read', 'list'] }),
      service: Type.Optional(Type.String({ enum: [...KNOWN_SERVICES] })),
      lines: Type.Optional(Type.Number({ default: 100 })),
      force: Type.Optional(
        Type.Boolean({
          description:
            'start only: kill whatever is already bound to the target port before starting.',
        }),
      ),
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
                  let icon: string;
                  if (svcStatus.state === 'crashed') {
                    icon = '❌';
                  } else if (svcStatus.portOpen) {
                    icon = '✅';
                  } else {
                    icon = '⏳';
                  }
                  const port = svcStatus.readyPort ? ` — :${svcStatus.readyPort}` : '';
                  let stateNote: string;
                  if (svcStatus.state === 'crashed') {
                    stateNote = ' — CRASHED';
                  } else if (svcStatus.state === 'booting') {
                    stateNote = ' — booting';
                  } else {
                    stateNote = '';
                  }
                  lines.push(`${icon} **${svcStatus.name}**${port}${stateNote}`);
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
                { type: 'text', text: `Service required. Valid: ${KNOWN_SERVICES.join(', ')}` },
              ],
              isError: true,
              details: {},
            };
          }

          const offset = contractPortOffset(currentContractId());

          // Check if already running (skip when forcing — we're about to
          // kill whatever's there anyway).
          const wsId = await findWorkspace(workspaceLabel);
          if (wsId && !params.force) {
            const tabNames = await getWorkspaceTabNames(wsId);
            const port = resolveReadyPort(params.service as DevService, mode, offset);
            if (tabNames.includes(svc.name) && port && (await isPortReady(port, svc.readyCheck))) {
              return {
                content: [{ type: 'text', text: `✅ ${svc.name} already running (port :${port})` }],
                details: {},
              };
            }
          }

          _onUpdate?.({
            content: [
              {
                type: 'text',
                text: params.force ? `Starting ${svc.name} (force)...` : `Starting ${svc.name}...`,
              },
            ],
            details: {},
          });

          try {
            await startServices({
              mode,
              services: [params.service as DevService],
              projectRoot: process.cwd(),
              forcePorts: params.force,
            });
            const port = resolveReadyPort(params.service as DevService, mode, offset);
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
                { type: 'text', text: `Service required. Valid: ${KNOWN_SERVICES.join(', ')}` },
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
            const port = resolveReadyPort(
              params.service as DevService,
              mode,
              contractPortOffset(currentContractId()),
            );
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
                { type: 'text', text: `Service required. Valid: ${KNOWN_SERVICES.join(', ')}` },
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
                { type: 'text', text: `Service required. Valid: ${KNOWN_SERVICES.join(', ')}` },
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

          const port = svc.readyPort?.(mode);
          const ready = port ? await isPortReady(port, svc.readyCheck) : true;
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
                { type: 'text', text: `Service required. Valid: ${KNOWN_SERVICES.join(', ')}` },
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
          const panes = await getWorkspacePanes(wsId, signal);
          const tabs = await getWorkspaceTabs(wsId, signal);
          const tab = tabs.find((t) => t.label === svc.name);
          if (!tab) {
            return { content: [{ type: 'text', text: `Tab ${svc.name} not found` }], details: {} };
          }

          const pane = panes.find((p) => p.tab_id === tab.tab_id);
          if (!pane) {
            return { content: [{ type: 'text', text: `No pane for ${svc.name}` }], details: {} };
          }

          const output = await execHerdrText(
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
