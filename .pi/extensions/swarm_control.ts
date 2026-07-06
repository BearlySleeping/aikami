// .pi/extensions/swarm_control.ts
/**
 * Swarm Control Pi Extension & Command Surface Wrapper (C-309).
 *
 * Registers custom pi tools that wrap the swarm_director.ts execution engine,
 * allowing developers to conversationalize pipeline dispatching, monitor active
 * worker locks, and fetch scratchpad statuses directly within the terminal agent loop.
 *
 * Tools:
 *   swarm_trigger_pipeline  — Launch swarm director background execution
 *   swarm_get_ledger_status  — Query SQLite scratchpad for live worker statuses
 */

import { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';
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
  }>;
};

// ── Constants ──────────────────────────────────────────────

const SCRATCHPAD_DB_PATH = '.pi/agent_scratchpad.db';
const AGENT_KEYS = ['architect', 'coder', 'qa', 'git'] as const;

// ── SQLite access ──────────────────────────────────────────

const _queryLedger = (): LedgerReportEnvelope | null => {
  let db: Database | null = null;
  try {
    db = new Database(SCRATCHPAD_DB_PATH, { readonly: true });

    // Check if tables exist
    const tables = db
      .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
      .all('table');

    const hasHeartbeat = tables.some((t) => t.name === 'swarm_heartbeat');

    if (!hasHeartbeat) {
      return {
        activeTaskId: 'none',
        globalLockActive: false,
        workerStates: AGENT_KEYS.map((key) => ({
          agentKey: key,
          status: 'idle',
          lastSyncTimestamp: 0,
        })),
      };
    }

    // Query active heartbeats
    const rows = db
      .query<
        {
          task_id: string;
          agent_key: string;
          agent_status: string;
          last_heartbeat_timestamp: number;
        },
        []
      >(
        `SELECT task_id, agent_key, agent_status, last_heartbeat_timestamp
         FROM swarm_heartbeat
         ORDER BY last_heartbeat_timestamp DESC
         LIMIT 20`,
      )
      .all();

    const workerStatesMap = new Map<string, LedgerReportEnvelope['workerStates'][number]>();

    for (const row of rows) {
      workerStatesMap.set(row.agent_key, {
        agentKey: row.agent_key,
        status: row.agent_status,
        lastSyncTimestamp: row.last_heartbeat_timestamp,
      });
    }

    // Fill missing agents as idle
    for (const key of AGENT_KEYS) {
      if (!workerStatesMap.has(key)) {
        workerStatesMap.set(key, {
          agentKey: key,
          status: 'idle',
          lastSyncTimestamp: 0,
        });
      }
    }

    const firstRow = rows[0];
    const activeTaskId = firstRow ? firstRow.task_id : 'none';
    const globalLockActive = [...workerStatesMap.values()].some(
      (w) => w.status === 'working' || w.status === 'blocked',
    );

    return {
      activeTaskId,
      globalLockActive,
      workerStates: [...workerStatesMap.values()],
    };
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
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
      'Assembles the swarm workspace, dispatches the task to architect→coder→qa→git agents, ' +
      'and returns a session identifier for status tracking.',
    promptSnippet:
      'Use swarm_trigger_pipeline to dispatch multi-agent tasks to the swarm director.',
    promptGuidelines: [
      'Use for complex multi-step tasks requiring architect/coder/qa/git coordination.',
      'Returns a session ID — track progress with swarm_get_ledger_status.',
      'The pipeline runs out-of-process; pi is not blocked.',
      'Model tier "pro" uses reasoning models (gpt-4o), "flash" uses fast models (gpt-4o-mini).',
    ],
    parameters: Type.Object({
      taskId: Type.String({
        description: 'Unique task identifier (e.g. contract number like C-305)',
      }),
      initialTaskDescription: Type.String({
        description: 'Natural-language description of what the task should accomplish',
      }),
      forceModelTierSelection: Type.Optional(
        Type.String({
          description: 'Model tier override: pro (reasoning) or flash (fast). Default: auto.',
          enum: ['pro', 'flash', 'default'],
          default: 'default',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;

      // Build the payload JSON for swarm_start.ts
      const tier =
        params.forceModelTierSelection === 'default' ? 'flash' : params.forceModelTierSelection;

      const payload = {
        taskId: params.taskId,
        description: params.initialTaskDescription,
        tier,
        steps: [
          {
            stepIndex: 0,
            agent: 'architect',
            command: `echo "[architect] Analyzing task: ${params.taskId}"`,
            complianceSignature: 'analyzed',
          },
          {
            stepIndex: 1,
            agent: 'coder',
            command: `echo "[coder] Implementing: ${params.initialTaskDescription.slice(0, 60)}"`,
            complianceSignature: 'implementing',
          },
          {
            stepIndex: 2,
            agent: 'qa',
            command: `echo "[qa] Validating: ${params.taskId}"`,
            complianceSignature: 'validated',
          },
          {
            stepIndex: 3,
            agent: 'git',
            command: `echo "[git] Committing: ${params.taskId}"`,
            complianceSignature: 'committed',
          },
        ],
      };

      // Write payload to temp file
      const tmpFile = `${cwd}/.pi/pipeline_payload_${params.taskId}.json`;
      writeFileSync(tmpFile, JSON.stringify(payload, null, 2));

      // Launch swarm director via herdr in background
      const command = `direnv exec . bash -c 'bun run scripts/src/lib/agents/swarm_start.ts ${tmpFile}; echo; echo "=== Swarm pipeline complete ==="; read'`;

      const result = await pi.exec('herdr', [
        'pane',
        'run',
        '--workspace',
        'aikami-agents',
        '--cwd',
        cwd,
        command,
      ]);

      const sessionId = `swarm_${params.taskId}_${Date.now()}`;

      return {
        content: [
          {
            type: 'text',
            text: `🚀 Pipeline dispatched: ${params.taskId}\nSession: ${sessionId}\nTier: ${tier}\nAttach: \`herdr session attach default\`\nStatus: \`swarm_get_ledger_status\``,
          },
        ],
        details: {
          sessionId,
          taskId: params.taskId,
          tier,
          exitCode: result.code,
        },
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
      const originalDir = process.cwd();

      // Ensure we're in the project root for relative path resolution
      try {
        process.chdir(cwd);
      } catch {
        // fall through
      }

      const ledger = _queryLedger();

      // Restore original dir
      try {
        process.chdir(originalDir);
      } catch {
        // fall through
      }

      if (!ledger) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ Scratchpad database not found. No swarm agents have been initialized.\nRun `swarm_trigger_pipeline` first, or initialize with `bun swarm:init`.',
            },
          ],
          details: { error: 'db-not-found' },
        };
      }

      // Build status report
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
        return `${icon} **${w.agentKey}** — ${w.status} (${ago})`;
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
