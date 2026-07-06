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

// ── SQLite access via pi.exec (pi runs in Node.js, not Bun) ──

const _queryLedger = async (
  pi: ExtensionAPI,
  cwd: string,
): Promise<LedgerReportEnvelope | null> => {
  /** Inline Bun script that reads the scratchpad heartbeat table and outputs JSON. */
  const inlineScript = `
    import { Database } from 'bun:sqlite';
    const dbPath = '${SCRATCHPAD_DB_PATH}';
    let db;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch {
      console.log('null');
      return;
    }

    const tables = db.query('SELECT name FROM sqlite_master WHERE type = ?').all('table');
    const hasHeartbeat = tables.some(function(t) { return t.name === 'swarm_heartbeat'; });

    if (!hasHeartbeat) {
      console.log(JSON.stringify({
        activeTaskId: 'none',
        globalLockActive: false,
        workerStates: [
          { agentKey: 'architect', status: 'idle', lastSyncTimestamp: 0 },
          { agentKey: 'coder', status: 'idle', lastSyncTimestamp: 0 },
          { agentKey: 'qa', status: 'idle', lastSyncTimestamp: 0 },
          { agentKey: 'git', status: 'idle', lastSyncTimestamp: 0 },
        ],
      }));
      db.close();
      return;
    }

    const rows = db.query(
      'SELECT task_id, agent_key, agent_status, last_heartbeat_timestamp FROM swarm_heartbeat ORDER BY last_heartbeat_timestamp DESC LIMIT 20'
    ).all();

    var workerMap = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      workerMap[r.agent_key] = {
        agentKey: r.agent_key,
        status: r.agent_status,
        lastSyncTimestamp: r.last_heartbeat_timestamp,
      };
    }
    ['architect','coder','qa','git'].forEach(function(k) {
      if (!workerMap[k]) workerMap[k] = { agentKey: k, status: 'idle', lastSyncTimestamp: 0 };
    });

    var activeId = rows.length > 0 ? rows[0].task_id : 'none';
    var locked = Object.values(workerMap).some(function(w) { return w.status === 'working' || w.status === 'blocked'; });

    console.log(JSON.stringify({
      activeTaskId: activeId,
      globalLockActive: locked,
      workerStates: Object.values(workerMap),
    }));

    db.close();
  `;

  try {
    const result = await pi.exec('bun', ['-e', inlineScript], { cwd } as any);
    if (result.code !== 0 || !result.stdout) {
      return null;
    }
    return JSON.parse(result.stdout.trim()) as LedgerReportEnvelope;
  } catch {
    return null;
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

      const ledger = await _queryLedger(pi, cwd);

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
