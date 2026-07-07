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
import { getModelForTier } from '../../.pi/swarm/models';

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

// ── Model mapping (from .pi/swarm/models.ts) ───────────────

// ── Helpers ──────────────────────────────────────────────────

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
          description: 'Model tier override: pro (reasoning) or flash (fast). Default: auto.',
          enum: ['pro', 'flash', 'default'],
          default: 'default',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;

      const tier: string =
        params.forceModelTierSelection === 'default' || !params.forceModelTierSelection
          ? 'flash'
          : params.forceModelTierSelection;

      const model = getModelForTier(tier);
      const taskId = params.taskId;
      const contractPath = params.contractPath ?? `docs/contracts/${taskId}.md`;

      const architectPlanPath = `.pi/swarm/plans/architect_plan_${taskId}.md`;

      const payload = {
        taskId,
        description: params.initialTaskDescription,
        tier,
        steps: [
          {
            stepIndex: 0,
            agent: 'architect',
            command: `pi --model ${model} --system-prompt .pi/prompts/architect.md '${contractPath}'`,
          },
          {
            stepIndex: 1,
            agent: 'coder',
            command: `pi --model ${model} --system-prompt .pi/prompts/coder.md '${architectPlanPath}'`,
          },
          {
            stepIndex: 2,
            agent: 'qa',
            command: `pi --model ${model} --system-prompt .pi/prompts/qa.md '${architectPlanPath}'`,
          },
          {
            stepIndex: 3,
            agent: 'git',
            command: `pi --model ${model} --system-prompt .pi/prompts/git.md '${architectPlanPath}'`,
          },
        ],
      };

      // Write payload to temp file
      const tmpFile = `${cwd}/.pi/pipeline_payload_${params.taskId}.json`;
      writeFileSync(tmpFile, JSON.stringify(payload, null, 2));

      // ── Discover or create contract workspace ──────────────
      // Workspace label derived from taskId: aikami-agents-C-191, etc.
      const wsLabel = `aikami-agents-${params.taskId}`;
      const discoverWs = await pi.exec('herdr', ['workspace', 'list']);

      let directorPaneId = '';
      try {
        const wsData = JSON.parse(discoverWs.stdout || '{}');
        const wss = wsData?.result?.workspaces as
          | Array<{ workspace_id: string; label: string; number: number }>
          | undefined;
        let ws = wss?.find((w) => w.label === wsLabel);

        if (!ws) {
          // Create new contract workspace
          const createR = await pi.exec('herdr', [
            'workspace',
            'create',
            '--cwd',
            cwd,
            '--label',
            wsLabel,
            '--no-focus',
          ]);
          const createData = JSON.parse(createR.stdout || '{}');
          ws = createData?.result?.workspace;
          if (!ws) {
            throw new Error('Workspace creation failed');
          }
        }

        // Find director tab (tab 1) — initializeSwarm renames it to 'director'
        const tabsResult = await pi.exec('herdr', ['tab', 'list', '--workspace', ws.workspace_id]);
        const tabsData = JSON.parse(tabsResult.stdout || '{}');
        const firstTab = tabsData?.result?.tabs?.[0] as
          | { tab_id: string; number: number }
          | undefined;

        if (firstTab) {
          // Pane ID: herdr CLI uses <workspace_number>-<pane_number>
          directorPaneId = `${ws.number}-1`;
        } else {
          throw new Error('No tabs in workspace');
        }
      } catch (err) {
        console.error('[swarm:trigger] failed to discover/create workspace:', err);
      }

      if (!directorPaneId) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Could not create swarm workspace '${wsLabel}'.`,
            },
          ],
          details: { error: 'no-director-pane' },
        };
      }

      console.error('[swarm:trigger] director pane:', directorPaneId, 'workspace:', wsLabel);

      // Launch swarm director via herdr in the director pane
      const command = `direnv exec . bash -c 'bun run scripts/src/lib/agents/swarm_start.ts ${tmpFile}; echo; echo "=== Swarm pipeline complete ==="; read'`;

      const result = await pi.exec('herdr', ['pane', 'run', directorPaneId, command]);

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

      // Execute the ledger query script via Bun (bypasses extension caching issues)
      const result = await pi.exec('bun', [
        'run',
        `${cwd}/scripts/src/lib/agents/swarm_ledger_query.ts`,
      ]);

      if (result.code !== 0 || !result.stdout) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ Failed to read scratchpad database. Ensure the swarm has been initialized (`bun swarm:init`).',
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
          content: [
            {
              type: 'text',
              text: '⚠️ Invalid ledger output. Scratchpad database may be corrupt.',
            },
          ],
          details: { error: 'invalid-json' },
        };
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
        let line = `${icon} **${w.agentKey}** — ${w.status} (${ago})`;
        if (w.agentOutput?.trim()) {
          // Show first line of summary as a hint
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
