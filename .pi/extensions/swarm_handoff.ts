// .pi/extensions/swarm_handoff.ts
/**
 * Swarm Handoff Pi Extension (C-SWARM-HARDEN).
 *
 * Registers swarm_handoff and swarm_review_respond tools for swarm agents
 * and user interaction. Eliminates the silent-timeout class of failures from
 * malformed JSON handoffs by validating at write-time with actionable errors.
 *
 * Tools:
 *   swarm_handoff          — Agents call this to finish their step (validated write)
 *   swarm_review_respond   — User calls this from main pi session to approve/reject/feedback
 *
 * Commands (zero-LLM — instant, no tokens burned):
 *   /approve  [taskId]        — approve the awaiting review (auto-detects taskId)
 *   /reject   [taskId]        — reject and stop the pipeline
 *   /feedback [taskId] <text> — send feedback text back to the coder
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Helpers ──────────────────────────────────────────────────

/**
 * Validate a handoff payload and return error messages if invalid.
 * Returns null if valid.
 */
const validateHandoff = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null) {
    return 'payload must be an object';
  }
  const p = payload as Record<string, unknown>;
  const required = ['taskId', 'role', 'status', 'complexity', 'domain', 'summary'];
  for (const key of required) {
    if (!p[key]) {
      return `missing required field: ${key}`;
    }
  }
  if (typeof p.summary === 'string' && p.summary.length > 2048) {
    return 'summary exceeds 2048 characters';
  }
  return null;
};

/** Atomic write: tmp file + rename. */
const atomicWrite = (filePath: string, content: string): void => {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
};

/**
 * Find the task currently awaiting review (review handoff with
 * status=awaiting_approval). Returns null if none / ambiguous handling
 * is left to the caller (most recent mtime wins).
 */
const findAwaitingReviewTask = (cwd: string): string | null => {
  const outputsDir = join(cwd, '.pi/swarm/outputs');
  try {
    const candidates = readdirSync(outputsDir)
      .filter((f) => f.endsWith('_review_handoff.json'))
      .map((f) => {
        try {
          const h = JSON.parse(readFileSync(join(outputsDir, f), 'utf-8')) as {
            taskId?: string;
            status?: string;
          };
          return h.status === 'awaiting_approval' && h.taskId ? h.taskId : null;
        } catch {
          return null;
        }
      })
      .filter((t): t is string => t !== null);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
};

/** Write a review decision handoff. Shared by tool + commands. */
const writeReviewDecision = (
  cwd: string,
  taskId: string,
  decision: 'approve' | 'reject' | 'feedback',
  feedback?: string,
): void => {
  const statusMap = { approve: 'approved', reject: 'rejected', feedback: 'feedback' } as const;
  const summary =
    decision === 'feedback'
      ? (feedback ?? '')
      : decision === 'approve'
        ? 'User approved. Proceed to commit & push.'
        : 'User rejected. Pipeline stopped.';

  const payload = {
    taskId,
    role: 'review',
    status: statusMap[decision],
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: [],
    nextCommands: [],
    summary: summary.slice(0, 2048),
  };

  const outputsDir = join(cwd, '.pi/swarm/outputs');
  mkdirSync(outputsDir, { recursive: true });
  const filePath = join(outputsDir, `${taskId}_review_handoff.json`);
  try {
    unlinkSync(`${filePath}.tmp`);
  } catch {
    /* ok */
  }
  atomicWrite(filePath, JSON.stringify(payload, null, 2));
};

/** Parse `[taskId] [rest...]` from command args. */
const parseReviewArgs = (args: string, cwd: string): { taskId: string | null; rest: string } => {
  const trimmed = (args ?? '').trim();
  const firstWord = trimmed.split(/\s+/)[0] ?? '';
  if (/^C-[\w-]+$/i.test(firstWord)) {
    return { taskId: firstWord.toUpperCase(), rest: trimmed.slice(firstWord.length).trim() };
  }
  return { taskId: findAwaitingReviewTask(cwd), rest: trimmed };
};

// ── Extension registration ───────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ─────────────────────────────────────────────────────────┐
  // Tool 1: swarm_handoff                                   │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'swarm_handoff',
    label: 'Swarm: Write Handoff',
    description:
      'Write a validated step-completion handoff for the swarm pipeline. ' +
      'Validates the payload against SwarmHandoffSchema at write-time, returning ' +
      'actionable validation errors so the agent can retry immediately (no silent 30-min timeout). ' +
      'On success: atomic write (tmp+rename) of .pi/swarm/outputs/<taskId>_<role>_handoff.json. ' +
      'The director detects the file and advances the pipeline.',
    promptSnippet: 'Use swarm_handoff to write a completion handoff at the end of your swarm step.',
    parameters: Type.Object({
      taskId: Type.String({
        description: 'Unique task identifier (e.g. "C-311")',
      }),
      role: Type.String({
        description: 'Agent role: architect, coder, qa, git, review, or document',
      }),
      status: Type.String({
        description:
          'Step status: success, failed, escalated, awaiting_approval, approved, rejected, feedback',
      }),
      complexity: Type.String({
        description: 'Task complexity: trivial, standard, or complex',
        default: 'standard',
      }),
      domain: Type.String({
        description: 'Work domain: frontend, backend, or fullstack',
        default: 'fullstack',
      }),
      requiresDocs: Type.Boolean({
        description: 'Whether documentation generation is needed',
        default: false,
      }),
      filesTouched: Type.Array(Type.String(), {
        description: 'List of files created or modified',
        default: [],
      }),
      nextCommands: Type.Array(Type.String(), {
        description: 'Shell commands for downstream agents to execute',
        default: [],
      }),
      summary: Type.String({
        description: 'Human-readable summary (max 2048 chars)',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;

      // ── Validate against the schema ──
      const validationError = validateHandoff(params);
      if (validationError) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Handoff validation failed. Fix these errors and retry:\n\n${validationError}`,
            },
          ],
          details: { error: 'validation-failed', validationError },
        };
      }

      // ── Atomic write ──
      const outputsDir = join(cwd, '.pi/swarm/outputs');
      mkdirSync(outputsDir, { recursive: true });
      const filePath = join(outputsDir, `${params.taskId}_${params.role}_handoff.json`);

      // Clean up stale tmp if it exists
      try {
        unlinkSync(`${filePath}.tmp`);
      } catch {
        /* ok */
      }

      try {
        atomicWrite(filePath, JSON.stringify(params, null, 2));
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to write handoff: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: 'write-failed' },
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Handoff written: \`.pi/swarm/outputs/${params.taskId}_${params.role}_handoff.json\`\nStatus: ${params.status}\nFiles: ${params.filesTouched.length}\nSummary: ${params.summary.slice(0, 100)}`,
          },
        ],
        details: { taskId: params.taskId, role: params.role, status: params.status },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 2: swarm_review_respond                            │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'swarm_review_respond',
    label: 'Swarm: Review Respond',
    description:
      'Respond to a swarm review gate request from your MAIN pi session. ' +
      "Writes the review_handoff.json the director's waitForHandoff loop already accepts. " +
      'No need to switch to the review pane or use stdin — approve, reject, or send ' +
      'feedback directly from here. The review_gate.ts stdin loop stays as fallback; ' +
      'both write the same artifact.',
    promptSnippet:
      'Use swarm_review_respond to approve, reject, or send feedback on a swarm review.',
    promptGuidelines: [
      'Use this from your main pi session during a swarm pipeline review.',
      'The director detects the handoff file and advances the pipeline automatically.',
      'Status "feedback" sends the summary back to the coder for revision.',
      'The stdin review_gate.ts remains available as fallback.',
    ],
    parameters: Type.Object({
      taskId: Type.String({
        description: 'Task identifier (e.g. "C-311")',
      }),
      decision: Type.String({
        description: 'Review decision: approve, reject, or feedback',
        enum: ['approve', 'reject', 'feedback'],
      }),
      feedback: Type.Optional(
        Type.String({
          description: 'Feedback text (required when decision is "feedback")',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;

      if (params.decision === 'feedback' && !params.feedback?.trim()) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ Feedback text is required when decision is "feedback".',
            },
          ],
          details: { error: 'missing-feedback' },
        };
      }

      try {
        writeReviewDecision(
          cwd,
          params.taskId,
          params.decision as 'approve' | 'reject' | 'feedback',
          params.feedback,
        );
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to write review handoff: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: 'write-failed' },
        };
      }

      const icons: Record<string, string> = {
        approve: '✅',
        reject: '❌',
        feedback: '🔄',
      };

      return {
        content: [
          {
            type: 'text',
            text: `${icons[params.decision]} Review ${params.decision}d for ${params.taskId}. Pipeline will continue.`,
          },
        ],
        details: { taskId: params.taskId, decision: params.decision },
      };
    },
  });

  // ─────────────────────────────────────────────────────┐
  // Commands: /approve /reject /feedback (zero-LLM)        │
  // ─────────────────────────────────────────────────────┘

  pi.registerCommand('approve', {
    description: 'Approve the awaiting swarm review → commit & push. Usage: /approve [taskId]',
    handler: async (args, ctx) => {
      const { taskId } = parseReviewArgs(args, ctx.cwd);
      if (!taskId) {
        ctx.ui.notify('No swarm review awaiting approval. Usage: /approve <taskId>', 'warning');
        return;
      }
      writeReviewDecision(ctx.cwd, taskId, 'approve');
      ctx.ui.notify(`✅ ${taskId} approved — pipeline proceeding to commit & push.`, 'info');
    },
  });

  pi.registerCommand('reject', {
    description: 'Reject the awaiting swarm review → stop pipeline. Usage: /reject [taskId]',
    handler: async (args, ctx) => {
      const { taskId } = parseReviewArgs(args, ctx.cwd);
      if (!taskId) {
        ctx.ui.notify('No swarm review awaiting approval. Usage: /reject <taskId>', 'warning');
        return;
      }
      writeReviewDecision(ctx.cwd, taskId, 'reject');
      ctx.ui.notify(`❌ ${taskId} rejected — pipeline stopped.`, 'info');
    },
  });

  pi.registerCommand('feedback', {
    description: 'Send feedback to the swarm coder for revision. Usage: /feedback [taskId] <text>',
    handler: async (args, ctx) => {
      const { taskId, rest } = parseReviewArgs(args, ctx.cwd);
      if (!taskId) {
        ctx.ui.notify(
          'No swarm review awaiting approval. Usage: /feedback <taskId> <text>',
          'warning',
        );
        return;
      }
      if (!rest.trim()) {
        ctx.ui.notify('Feedback text required. Usage: /feedback [taskId] <text>', 'warning');
        return;
      }
      writeReviewDecision(ctx.cwd, taskId, 'feedback', rest.trim());
      ctx.ui.notify(`🔄 Feedback sent to coder for ${taskId}.`, 'info');
    },
  });
}
