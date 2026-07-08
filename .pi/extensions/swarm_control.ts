// .pi/extensions/swarm_control.ts
/**
 * Swarm Control Pi Extension (C-309 v2).
 *
 * Registers custom pi tools for swarm pipeline dispatch and status querying.
 * All payload construction is delegated to swarm_run.ts — single source of truth.
 *
 * Tools:
 *   swarm_trigger_pipeline  — Spawns `bun swarm:run <taskId>` in background
 *   swarm_get_ledger_status  — Query SQLite scratchpad for live worker statuses
 */

import { spawn } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Types ──────────────────────────────────────────────────

type LedgerReportEnvelope = {
  activeTaskId: string;
  globalLockActive: boolean;
  workerStates: Array<{
    agentKey: string;
    status: string;
    lastSyncTimestamp: number;
    agentOutput: string;
  }>;
};

// ── Extension registration ─────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ─────────────────────────────────────────────────────────┐
  // Tool 1: swarm_trigger_pipeline                          │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'swarm_trigger_pipeline',
    label: 'Swarm: Trigger Pipeline',
    description:
      'Launch a swarm director pipeline execution in a background herdr tab. ' +
      'Delegates to `bun swarm:run` for payload construction — single source of truth.',
    promptSnippet:
      'Use swarm_trigger_pipeline to dispatch multi-agent tasks to the swarm director.',
    promptGuidelines: [
      'Use for complex multi-step tasks requiring architect/coder/qa/git coordination.',
      'Returns a session ID — track progress with swarm_get_ledger_status.',
      'The pipeline runs out-of-process; pi is not blocked.',
      'Model tier "pro" uses deepseek-v4-pro, "flash" uses deepseek-v4-flash.',
    ],
    parameters: Type.Object({
      taskId: Type.String({
        description: 'Unique task identifier (e.g. contract number like C-305)',
      }),
      initialTaskDescription: Type.String({
        description: 'Natural-language description of what the task should accomplish',
      }),
      contractPath: Type.Optional(
        Type.String({
          description:
            'Path to the contract file (e.g. docs/contracts/C-305.md). If omitted, derives from taskId.',
        }),
      ),
      forceModelTierSelection: Type.Optional(
        Type.String({
          description: 'Model tier override: pro (reasoning) or flash (fast). Default: flash.',
          enum: ['pro', 'flash', 'default'],
          default: 'default',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const taskId = params.taskId;
      const tier =
        params.forceModelTierSelection === 'default' || !params.forceModelTierSelection
          ? 'flash'
          : params.forceModelTierSelection;

      // Delegate to swarm_run.ts — single source of truth for payload construction
      // Write pipeline output to a log file so failures are debuggable
      const { mkdirSync, openSync } = await import('node:fs');
      const { join } = await import('node:path');
      const logDir = join(cwd, '.pi/swarm/outputs');
      mkdirSync(logDir, { recursive: true });
      const logFd = openSync(join(logDir, `${taskId}_pipeline.log`), 'a');

      const child = spawn('bun', ['swarm:run', taskId, '--tier', tier], {
        cwd,
        stdio: ['ignore', logFd, logFd],
        detached: true,
      });
      child.unref();

      const pid = child.pid ?? 'unknown';

      return {
        content: [
          {
            type: 'text',
            text: `🚀 Pipeline dispatched: ${taskId}\nPID: ${pid}\nTier: ${tier}\nStatus: \`swarm_get_ledger_status\``,
          },
        ],
        details: { taskId, pid, tier },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 2: swarm_get_ledger_status                         │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'swarm_get_ledger_status',
    label: 'Swarm: Get Ledger Status',
    description:
      'Query the SQLite WAL scratchpad database to surface live statuses of ' +
      'worker processes (architect, coder, qa, git). Returns a condensed status ' +
      'report with active task ID, global lock state, and per-agent status/timestamps.',
    promptSnippet:
      'Use swarm_get_ledger_status to inspect swarm agent health and pipeline progress.',
    promptGuidelines: [
      'Use to check if swarm agents are idle, working, blocked, or done.',
      'Sub-10ms SQLite query — safe for frequent polling.',
      'Returns all 4 agents even if some are idle/unknown.',
      'Check globalLockActive to see if any agent is in working/blocked state.',
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;

      const result = await pi.exec('bun', [
        'run',
        `${cwd}/scripts/src/lib/agents/swarm_ledger_query.ts`,
      ]);

      if (result.code !== 0 || !result.stdout) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ Failed to read scratchpad database. Ensure the swarm has been initialized.',
            },
          ],
          details: { error: 'ledger-query-failed', exitCode: result.code },
        };
      }

      let ledger: LedgerReportEnvelope | null = null;
      try {
        ledger = JSON.parse(result.stdout.trim()) as LedgerReportEnvelope;
      } catch {
        return {
          content: [{ type: 'text', text: '⚠️ Invalid ledger output.' }],
          details: { error: 'invalid-json' },
        };
      }

      if (!ledger) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ Scratchpad database not found. Run `swarm_trigger_pipeline` first.',
            },
          ],
          details: { error: 'db-not-found' },
        };
      }

      const icons: Record<string, string> = {
        idle: '⏸️',
        working: '🟢',
        blocked: '🔴',
        done: '✅',
        unknown: '❓',
      };

      const statusLines = ledger.workerStates.map((w) => {
        const icon = icons[w.status] ?? '❓';
        const ago =
          w.lastSyncTimestamp > 0
            ? `${Math.round((Date.now() - w.lastSyncTimestamp) / 1000)}s ago`
            : 'never';
        let line = `${icon} **${w.agentKey}** — ${w.status} (${ago})`;
        if (w.agentOutput?.trim()) {
          const firstLine = w.agentOutput.trim().split('\n')[0]?.slice(0, 120) ?? '';
          if (firstLine) {
            line += ` — ${firstLine}`;
          }
        }
        return line;
      });

      const lockIcon = ledger.globalLockActive ? '🔒' : '🔓';

      const report = [
        `**Swarm Ledger Status**`,
        `Task: \`${ledger.activeTaskId}\` ${lockIcon}`,
        '',
        ...statusLines,
        '',
        `Attach: \`herdr session attach default\``,
      ].join('\n');

      return {
        content: [{ type: 'text', text: report }],
        details: ledger,
      };
    },
  });
}
