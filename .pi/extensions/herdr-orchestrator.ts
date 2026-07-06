// .pi/extensions/herdr-orchestrator.ts
// Manages Aikami dev services in herdr workspaces using the shared naming convention:
//   aikami-{mode}
//
// Each service is a herdr tab inside its mode workspace.
// Tabs are matched by name, not fixed indices.
//
// This is one of three consumers sharing the exact same herdr server:
//   1. pi extension (this file)
//   2. test_blackbox
//   3. root package.json scripts (herdr:start, herdr:stop, etc.)
//
// Services survive pi restarts. Pi can read output from any tab.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { EMULATOR_PORTS } from '../../packages/shared/constants/src/lib/development_ports';

type AikamiMode = 'emulator' | 'staging' | 'production';

type ServiceDef = {
  name: string;
  /** Canonical key matching package.json scripts */
  key: string;
  command: string;
  cwd: string;
  /** Port getter */
  getReadyPort?: (mode: AikamiMode) => number;
  readyPath?: string;
};

function makeServices(): Record<string, ServiceDef> {
  return {
    firebase: {
      name: 'firebase',
      key: 'firebase',
      command: 'bun run emulate',
      cwd: 'apps/backend/firebase',
      getReadyPort: () => EMULATOR_PORTS.auth,
    },
    client: {
      name: 'client',
      key: 'client',
      command: 'bun run dev',
      cwd: 'apps/frontend/client',
      getReadyPort: (mode: AikamiMode) => {
        const { PORTS } =
          require('../../packages/shared/constants/src/lib/development_ports') as any;
        return (PORTS as any)[mode]?.client ?? EMULATOR_PORTS.client;
      },
      readyPath: '/',
    },
    image: {
      name: 'image',
      key: 'image',
      command: 'bun run dev:docker',
      cwd: 'apps/backend/image',
      getReadyPort: () => EMULATOR_PORTS.image,
      readyPath: '/',
    },
    text: {
      name: 'text',
      key: 'text',
      command: 'bun run dev:docker',
      cwd: 'apps/backend/text',
      getReadyPort: () => EMULATOR_PORTS.text,
      readyPath: '/',
    },
    voice: {
      name: 'voice',
      key: 'voice',
      command: 'bun run dev:docker',
      cwd: 'apps/backend/voice',
      getReadyPort: () => EMULATOR_PORTS.voice,
      readyPath: '/',
    },
    'preview-client': {
      name: 'preview-client',
      key: 'preview-client',
      command: 'bun run scripts/src/lib/ops/preview_client.ts',
      cwd: '.',
    },
  };
}

const SERVICES = makeServices();
const ALL_SERVICES = Object.keys(SERVICES);

function getMode(): AikamiMode {
  const env = process.env.AIKAMI_MODE as string | undefined;
  if (env === 'emulator' || env === 'staging' || env === 'production') {
    return env;
  }
  return 'emulator';
}

/** Single workspace per mode — all services share this workspace. */
function workspaceName(): string {
  return `aikami-${getMode()}`;
}

export default function (pi: ExtensionAPI) {
  // ── Herdr helpers ────────────────────────────────────────────

  async function herdr(
    args: string[],
    extraEnv?: Record<string, string>,
  ): Promise<{ code: number; stdout: string }> {
    const r = await pi.exec('herdr', args, { env: { ...process.env, ...extraEnv } } as any);
    return { code: r.code, stdout: r.stdout?.trim() ?? '' };
  }

  async function herdrJson<T>(args: string[]): Promise<T | null> {
    const r = await herdr(args);
    if (r.code !== 0 || !r.stdout) {
      return null;
    }
    try {
      return JSON.parse(r.stdout) as T;
    } catch {
      return null;
    }
  }

  async function serverRunning(): Promise<boolean> {
    const r = await herdr(['status', 'server']);
    return r.code === 0;
  }

  async function ensureServer(): Promise<void> {
    if (await serverRunning()) {
      return;
    }
    // Start headless server
    await pi.exec('herdr', ['server'], { background: true } as any);
    // Wait for server to come up
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await serverRunning()) {
        return;
      }
    }
  }

  // ── Workspace & tab discovery ────────────────────────────────

  type WorkspaceItem = {
    workspace_id: string;
    label: string;
  };

  async function findWorkspace(label: string): Promise<string | null> {
    const r = await herdrJson<{ result: { workspaces: WorkspaceItem[] } }>(['workspace', 'list']);
    if (!r?.result?.workspaces) {
      return null;
    }
    const ws = r.result.workspaces.find((w) => w.label === label);
    return ws?.workspace_id ?? null;
  }

  async function getTabNames(workspaceId: string): Promise<string[]> {
    const r = await herdrJson<{ result: { tabs: { tab_id: string; label: string }[] } }>([
      'tab',
      'list',
      '--workspace',
      workspaceId,
    ]);
    if (!r?.result?.tabs) {
      return [];
    }
    return r.result.tabs.map((t) => t.label);
  }

  type PaneEntry = {
    pane_id: string;
    tab_id?: string;
    title?: string;
    foreground_process_name?: string;
  };

  /** Find a pane in the workspace that belongs to a tab with the given label. */
  async function findPaneForTab(workspaceId: string, tabLabel: string): Promise<string | null> {
    // First find the tab ID
    const tabR = await herdrJson<{ result: { tabs: { tab_id: string; label: string }[] } }>([
      'tab',
      'list',
      '--workspace',
      workspaceId,
    ]);
    if (!tabR?.result?.tabs) {
      return null;
    }
    const tab = tabR.result.tabs.find((t) => t.label === tabLabel);
    if (!tab) {
      return null;
    }

    // Now find panes in this tab by listing all workspace panes
    const paneR = await herdrJson<{ result: { panes: PaneEntry[] } }>([
      'pane',
      'list',
      '--workspace',
      workspaceId,
    ]);
    if (!paneR?.result?.panes) {
      // Fallback: try constructing pane ID from tab ID.
      // Tab "1:2" → panes are workspace-level, not predictable without listing.
      // Try common herdr convention: tab ID format is "ws:tabIndex".
      // Pane IDs are "ws-paneIndex". Without listing, can't map.
      return null;
    }

    // Find first pane whose tab matches
    for (const pane of paneR.result.panes) {
      if (pane.tab_id === tab.tab_id) {
        return pane.pane_id;
      }
    }

    return null;
  }

  // ── Health check ──────────────────────────────────────────────

  async function isReady(svc: ServiceDef): Promise<boolean> {
    if (!svc.getReadyPort) {
      return true; // no port = always considered ready
    }
    const path = svc.readyPath ?? '/';
    const port = svc.getReadyPort(getMode());
    try {
      const r = await pi.exec('bash', [
        '-c',
        `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}${path} 2>/dev/null || echo '000'`,
      ]);
      const code = Number.parseInt(r.stdout?.trim() ?? '0', 10);
      return code >= 200 && code < 500;
    } catch {
      return false;
    }
  }

  // ── Main Tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: 'herdr_session',
    label: 'Herdr: Manage Dev Services',
    description:
      'Manage Aikami development services (firebase, client, image, text, voice) via herdr workspaces and tabs. ' +
      'Services survive pi restarts and can be inspected via `read` action. ' +
      'Workspaces use naming convention: aikami-{mode}. ' +
      'Each service is a herdr tab in the shared workspace, matched by name. ' +
      'If workspace already exists with same mode, tabs are added instead of recreating.',
    promptSnippet: 'Use herdr_session to start/stop/inspect Aikami dev services running in herdr.',
    promptGuidelines: [
      'Use herdr_session start <service> to start firebase, client, image, text, or voice.',
      'Use herdr_session read <service> to capture log output from a running service.',
      'Use herdr_session list to see all managed services and their status.',
      'Use herdr_session stop <service> to cleanly stop a service.',
      'Workspaces follow naming: aikami-{mode}. Attach: herdr session attach default',
      'These are the same sessions used by test_blackbox and root package.json herdr scripts.',
    ],
    parameters: Type.Object({
      action: Type.String({
        description: 'Action: start, stop, status, read, or list',
        enum: ['start', 'stop', 'status', 'read', 'list'],
      }),
      service: Type.Optional(
        Type.String({
          description: `Service name: ${ALL_SERVICES.join(', ')}`,
          enum: ALL_SERVICES,
        }),
      ),
      lines: Type.Optional(
        Type.Number({
          description: 'Lines to capture (read action only, default 100)',
          default: 100,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const ws = workspaceName();
      const mode = getMode();
      const svc = params.service ? SERVICES[params.service] : undefined;

      // Ensure server is running for all operations
      await ensureServer();

      // ── list ────────────────────────────────────────────────────
      if (params.action === 'list') {
        const wsId = await findWorkspace(ws);
        if (!wsId) {
          let out = '**Aikami Dev Services**\n\n';
          for (const s of Object.values(SERVICES)) {
            out += `⏸️ **${s.key}** — not running\n`;
          }
          out += '\nNo services running. Start with: herdr_session start <service>';
          return { content: [{ type: 'text', text: out }], details: {} };
        }

        const tabNames = await getTabNames(wsId);
        const parts: string[] = ['**Aikami Dev Services**\n'];
        let anyRunning = false;

        for (const [_name, s] of Object.entries(SERVICES)) {
          const running = tabNames.includes(s.name);
          if (!running) {
            parts.push(`⏸️ **${s.key}** — not running`);
            continue;
          }
          anyRunning = true;
          const ready = await isReady(s);
          const icon = ready ? '✅' : '⏳';
          const port = s.getReadyPort?.(mode);
          const portText = port != null ? ` — :${port}` : '';
          parts.push(`${icon} **${s.key}** (${ws})${portText}`);
        }
        if (anyRunning) {
          parts.push(`\nAttach: \`herdr session attach default\``);
        } else {
          parts.push('No services running. Start with: herdr_session start <service>');
        }
        return { content: [{ type: 'text', text: parts.join('\n') }], details: {} };
      }

      if (!svc) {
        return {
          content: [
            {
              type: 'text',
              text: `Service required for action '${params.action}'. Valid: ${ALL_SERVICES.join(', ')}`,
            },
          ],
          isError: true,
          details: {},
        };
      }

      // ── start ──────────────────────────────────────────────────
      if (params.action === 'start') {
        const wsId = await findWorkspace(ws);
        const tabNames = wsId ? await getTabNames(wsId) : [];

        if (tabNames.includes(svc.name) && (await isReady(svc))) {
          return {
            content: [
              {
                type: 'text',
                text: `✅ ${svc.name} already running${svc.getReadyPort ? ` (port :${svc.getReadyPort(mode)})` : ''}\nWorkspace: ${ws}\nAttach: \`herdr session attach default\``,
              },
            ],
            details: { alreadyRunning: true, workspace: ws },
          };
        }

        _onUpdate?.({
          content: [{ type: 'text', text: `Starting ${svc.name} in ${ws}...` }],
          details: {},
        });

        // If tab already exists but service isn't ready, kill and recreate the tab
        if (tabNames.includes(svc.name) && wsId) {
          const tabR = await herdrJson<{ result: { tabs: { tab_id: string; label: string }[] } }>([
            'tab',
            'list',
            '--workspace',
            wsId,
          ]);
          if (tabR?.result?.tabs) {
            const tab = tabR.result.tabs.find((t) => t.label === svc.name);
            if (tab) {
              await herdr(['tab', 'close', tab.tab_id]);
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }

        const svcCwd = `${cwd}/${svc.cwd}`;

        if (!wsId) {
          // Create workspace with first tab
          const createR = await herdrJson<{
            result: {
              workspace: { workspace_id: string };
              tab: { tab_id: string };
              root_pane: { pane_id: string };
            };
          }>(['workspace', 'create', '--cwd', svcCwd, '--label', ws, '--no-focus']);

          if (!createR?.result) {
            return {
              content: [{ type: 'text', text: `❌ Failed to create workspace ${ws}` }],
              isError: true,
              details: {},
            };
          }

          // Rename initial tab and run command
          const newWsId = createR.result.workspace.workspace_id;
          const rootPaneId = createR.result.root_pane.pane_id;
          await herdr(['tab', 'rename', `${newWsId}:1`, svc.name]);
          await herdr(['pane', 'run', rootPaneId, wrapCommand(svc.command)]);
        } else {
          // Add tab to existing workspace
          const tabR = await herdrJson<{
            result: { tab: { tab_id: string }; root_pane: { pane_id: string } };
          }>([
            'tab',
            'create',
            '--workspace',
            wsId,
            '--cwd',
            svcCwd,
            '--label',
            svc.name,
            '--no-focus',
          ]);

          if (tabR?.result) {
            await herdr(['pane', 'run', tabR.result.root_pane.pane_id, wrapCommand(svc.command)]);
          } else {
            return {
              content: [{ type: 'text', text: `❌ Failed to create tab ${svc.name} in ${ws}` }],
              isError: true,
              details: {},
            };
          }
        }

        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          if (signal?.aborted) {
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
          ready = await isReady(svc);
        }

        if (!ready) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠️ ${svc.name} started but not responding${svc.getReadyPort ? ` on port :${svc.getReadyPort(mode)}` : ''} after 60s.\nCheck: \`herdr session attach default\``,
              },
            ],
            isError: true,
            details: { timedOut: true, workspace: ws },
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `✅ ${svc.name} running${svc.getReadyPort ? ` (port :${svc.getReadyPort(mode)})` : ''}\nWorkspace: ${ws}\nAttach: \`herdr session attach default\``,
            },
          ],
          details: { workspace: ws },
        };
      }

      // ── stop ──────────────────────────────────────────────────
      if (params.action === 'stop') {
        const wsId = await findWorkspace(ws);
        if (!wsId) {
          return {
            content: [{ type: 'text', text: `Workspace ${ws} is not running.` }],
            details: {},
          };
        }

        const tabNames = await getTabNames(wsId);
        if (!tabNames.includes(svc.name)) {
          return {
            content: [{ type: 'text', text: `⏸️ ${svc.name} is not running in ${ws}.` }],
            details: {},
          };
        }

        // If this is the last tab, close the whole workspace
        if (tabNames.length === 1) {
          await herdr(['workspace', 'close', wsId]);
        } else {
          const tabR = await herdrJson<{ result: { tabs: { tab_id: string; label: string }[] } }>([
            'tab',
            'list',
            '--workspace',
            wsId,
          ]);
          if (tabR?.result?.tabs) {
            const tab = tabR.result.tabs.find((t) => t.label === svc.name);
            if (tab) {
              await herdr(['tab', 'close', tab.tab_id]);
            }
          }
        }

        return {
          content: [{ type: 'text', text: `🛑 Stopped ${svc.name} in ${ws}.` }],
          details: {},
        };
      }

      // ── status ────────────────────────────────────────────────
      if (params.action === 'status') {
        const wsId = await findWorkspace(ws);
        if (!wsId) {
          return {
            content: [
              { type: 'text', text: `⏸️ ${svc.name} — not running\nWorkspace would be: ${ws}` },
            ],
            details: { running: false },
          };
        }

        const tabNames = await getTabNames(wsId);
        if (!tabNames.includes(svc.name)) {
          return {
            content: [{ type: 'text', text: `⏸️ ${svc.name} — not running in ${ws}` }],
            details: { running: false },
          };
        }

        const ready = await isReady(svc);
        const icon = ready ? '✅' : '❌';
        return {
          content: [
            {
              type: 'text',
              text: `${icon} ${svc.name}${svc.getReadyPort ? ` — port :${svc.getReadyPort(mode)} ${ready ? 'responding' : 'NOT responding'}` : ''}\nWorkspace: ${ws}\nAttach: \`herdr session attach default\``,
            },
          ],
          details: { running: ready, workspace: ws },
        };
      }

      // ── read ──────────────────────────────────────────────────
      if (params.action === 'read') {
        const wsId = await findWorkspace(ws);
        if (!wsId) {
          return {
            content: [{ type: 'text', text: `Workspace ${ws} is not running.` }],
            details: {},
          };
        }

        const paneId = await findPaneForTab(wsId, svc.name);
        if (!paneId) {
          return {
            content: [
              {
                type: 'text',
                text: `No pane found for ${svc.name} in ${ws}. Service may not have started yet.\nCheck: \`herdr session attach default\``,
              },
            ],
            details: {},
          };
        }

        const lines = params.lines ?? 100;
        const result = await herdr([
          'pane',
          'read',
          paneId,
          '--source',
          'recent',
          '--lines',
          String(lines),
        ]);

        const output = result.stdout?.trim();
        if (!output) {
          return {
            content: [
              {
                type: 'text',
                text: `No output in ${svc.name}. Service may not have started yet.\nCheck: \`herdr session attach default\``,
              },
            ],
            details: {},
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `**${svc.name}** (last ${lines} lines):\n\n\`\`\`\n${output}\n\`\`\``,
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

/** Wrap a command with direnv and a keepalive read. */
function wrapCommand(command: string): string {
  const keepalive = `; echo; echo '=== Stopped. Press Enter to close ==='; read`;
  return `direnv exec . bash -c '${command}${keepalive}'`;
}
