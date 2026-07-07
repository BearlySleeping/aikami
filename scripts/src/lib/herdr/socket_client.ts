// scripts/src/lib/herdr/socket_client.ts
/**
 * Herdr Socket Client (C-311).
 *
 * Low-latency replacement for child_process.spawn('herdr') — uses Bun/Node
 * UNIX socket API for per-command connections to the herdr daemon.
 *
 * The herdr server uses its own protocol (NOT JSON-RPC 2.0):
 *   Request:  {"id":"<string>","method":"<method>","params":{...}}
 *   Response: {"id":"<string>","result":{...}} or {"id":"","error":{...}}
 *
 * Each command opens a fresh socket, sends a request, reads the response,
 * and closes. Same model as the herdr CLI binary.
 *
 * Socket path: HERDR_SOCKET_PATH or ~/.config/herdr/herdr.sock
 */

import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────────

type HerdrRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type HerdrResponse = {
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
};

export type PaneReadResult = {
  type: 'pane_read';
  read: {
    pane_id: string;
    text: string;
    source: string;
    format: string;
    truncated: boolean;
  };
};

export type AgentListEntry = {
  agent_id: string;
  pane_id: string;
  status: string;
  name: string;
};

export type AgentListResult = {
  type: 'agent_list';
  agents: AgentListEntry[];
};

export type TabListEntry = {
  tab_id: string;
  label: string;
  number: number;
};

export type PaneListEntry = {
  pane_id: string;
  tab_id: string;
};

export type WorkspaceListEntry = {
  workspace_id: string;
  label: string;
  number: number;
};

// ── Constants ──────────────────────────────────────────────

const DEFAULT_SOCKET_PATH =
  process.env.HERDR_SOCKET_PATH ?? join(homedir(), '.config', 'herdr', 'herdr.sock');
const DEFAULT_TIMEOUT_MS = 30_000;

// ── Client class ───────────────────────────────────────────

/**
 * Low-latency herdr socket client using per-command connections.
 * Mirrors the herdr CLI binary's socket protocol.
 */
export class HerdrSocketClient {
  private readonly _socketPath: string;
  private _idCounter = 0;

  constructor(options: { socketPath?: string }) {
    this._socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
  }

  static create(options: { socketPath?: string }): HerdrSocketClient {
    return new HerdrSocketClient(options);
  }

  // ── Core request/response ────────────────────────────────

  /**
   * Send a request over a fresh socket connection and return the result.
   */
  private _sendRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `swarm-${++this._idCounter}`;
      const request: HerdrRequest = { id, method, params };
      const payload = `${JSON.stringify(request)}\n`;

      const socket = connect(this._socketPath);
      let buffer = '';
      let settled = false;

      const settle = (error: Error | null, result?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.end();
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        settle(new Error(`Herdr request timed out: ${method}`));
      }, DEFAULT_TIMEOUT_MS);

      socket.on('connect', () => {
        socket.write(payload);
      });

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim() === '') {
            continue;
          }
          try {
            const message = JSON.parse(line) as HerdrResponse;
            if (message.id === id) {
              if (message.error) {
                settle(new Error(`Herdr error: ${message.error.message}`));
              } else {
                settle(null, message.result);
              }
              return;
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      socket.on('error', (err: Error) => {
        settle(new Error(`Herdr socket error: ${err.message}`));
      });

      socket.on('close', () => {
        settle(new Error(`Herdr connection closed without response: ${method}`));
      });
    });
  }

  // ── Convenience methods ──────────────────────────────────

  /** Read pane buffer content. */
  async paneRead(options: {
    paneId: string;
    source?: 'visible' | 'recent' | 'recent_unwrapped';
    lines?: number;
  }): Promise<string> {
    const { paneId, source = 'recent_unwrapped', lines = 150 } = options;
    const result = await this._sendRequest('pane.read', {
      pane_id: paneId,
      source,
      lines,
      format: 'text',
    });

    const typed = result as PaneReadResult;
    return typed?.read?.text ?? '';
  }

  /** Send text + Enter to a pane (like `herdr pane run`). */
  async paneRun(paneId: string, command: string): Promise<void> {
    await this._sendRequest('pane.send_text', {
      pane_id: paneId,
      text: `${command}\n`,
    });
  }

  /** Send keys to a pane. */
  async paneSendKeys(paneId: string, keys: string): Promise<void> {
    await this._sendRequest('pane.send_keys', {
      pane_id: paneId,
      keys: [keys],
    });
  }

  /** List all panes in a workspace. */
  async paneList(workspaceId: string): Promise<PaneListEntry[]> {
    const result = await this._sendRequest('pane.list', {
      workspace_id: workspaceId,
    });
    const data = result as { type: string; panes: PaneListEntry[] };
    return data?.panes ?? [];
  }

  /** List all tabs in a workspace. */
  async tabList(workspaceId: string): Promise<TabListEntry[]> {
    const result = await this._sendRequest('tab.list', {
      workspace_id: workspaceId,
    });
    const data = result as { type: string; tabs: TabListEntry[] };
    return data?.tabs ?? [];
  }

  /** List all workspaces. */
  async workspaceList(): Promise<WorkspaceListEntry[]> {
    const result = await this._sendRequest('workspace.list', {});
    const data = result as { type: string; workspaces: WorkspaceListEntry[] };
    return data?.workspaces ?? [];
  }

  /** Close a workspace. */
  async workspaceClose(workspaceId: string): Promise<void> {
    await this._sendRequest('workspace.close', {
      workspace_id: workspaceId,
    });
  }

  /** Show a system notification via herdr. */
  async showNotification(options: {
    title: string;
    message: string;
    level?: 'info' | 'warning' | 'error';
  }): Promise<void> {
    await this._sendRequest('notification.show', {
      title: options.title,
      message: options.message,
      level: options.level ?? 'info',
    });
  }

  /** List agents with their statuses. */
  async agentList(): Promise<AgentListEntry[]> {
    const result = await this._sendRequest('agent.list', {});
    const data = result as AgentListResult;
    return data?.agents ?? [];
  }

  /**
   * Wait for agent idle/done by polling pane.read.
   * Simple polling fallback — primary completion detection uses waitOutput
   * with SWARM_DONE markers.
   */
  async waitAgentIdle(options: {
    paneId: string;
    timeoutMs: number;
    pollIntervalMs?: number;
    taskId?: string;
    role?: string;
    afterTime?: number;
  }): Promise<boolean> {
    const { paneId, timeoutMs, pollIntervalMs = 2000, taskId, role, afterTime = 0 } = options;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const content = await this.paneRead({ paneId, source: 'recent_unwrapped', lines: 20 });
        if (/SWARM_DONE:\w+:\S+/.test(content) || /=== Swarm pipeline complete===/.test(content)) {
          return true;
        }
      } catch {
        // Read failed — wait and retry
      }

      // Check for output files (plan for architect, handoff for others)
      if (taskId && role) {
        try {
          const { statSync } = await import('node:fs');
          const { join } = await import('node:path');
          if (role === 'architect') {
            const planPath = join(process.cwd(), '.pi/swarm/plans', `architect_plan_${taskId}.md`);
            const stat = statSync(planPath);
            if (stat.size > 500 && (afterTime === 0 || stat.mtimeMs > afterTime)) {
              return true;
            }
          } else {
            const handoffPath = join(
              process.cwd(),
              '.pi/swarm/outputs',
              `${taskId}_${role}_handoff.json`,
            );
            const stat = statSync(handoffPath);
            if (stat.size > 100 && (afterTime === 0 || stat.mtimeMs > afterTime)) {
              return true;
            }
          }
        } catch {
          // File doesn't exist yet — keep polling
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return false;
  }

  /**
   * Wait for specific output in a pane (server-side blocking).
   * Uses herdr's native pane.wait_for_output API.
   */
  async waitOutput(options: {
    paneId: string;
    match: string;
    regex?: boolean;
    source?: string;
    timeoutMs: number;
  }): Promise<boolean> {
    try {
      await this._sendRequest('pane.wait_for_output', {
        pane_id: options.paneId,
        match: {
          type: options.regex ? 'regex' : 'substring',
          value: options.match,
        },
        source: options.source ?? 'recent',
        timeout_ms: options.timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}
