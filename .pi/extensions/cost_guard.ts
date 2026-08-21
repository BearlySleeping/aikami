/**
 * Cost Guard — runaway protection for pi sessions across four axes.
 *
 * Spend:
 *   Soft cap (PI_SOFT_SPEND, default $10): injects a wrap-up message telling
 *   the agent to stop tool calls and deliver a final summary.
 *   Hard cap (PI_HARD_SPEND, default $15): shuts down the session.
 *
 * Turns / wall-clock / repetition:
 *   Spend alone cannot catch a cheap runaway. A 2.5h, 308-turn session on a
 *   97%-cached model reached only ~$5 — well under both caps — while making
 *   no progress. These three guards bound the axes money does not.
 *
 * Pricing is read from pi's model registry at runtime (ctx.model.cost).
 * No hardcoded prices — always reflects the user's model catalog.
 *
 * Environment variables:
 *   PI_SOFT_SPEND            — Soft spend cap in USD (default: 10.00)
 *   PI_HARD_SPEND            — Hard spend cap in USD (default: 15.00)
 *   PI_MAX_TURNS             — Max assistant turns per user prompt (default: 120)
 *   PI_MAX_SESSION_MINUTES   — Max session wall-clock in minutes (default: 45)
 *   PI_REPETITION_GUARD      — Enable repetition collapse detection (default: 1)
 *   PI_REPETITION_THRESHOLD  — Repeats of one segment before tripping (default: 6)
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ContractWorkerRole } from '../../scripts/src/lib/agents/contract_pipeline/types';
import { maxRepeatedSegment } from './lib/repetition.ts';

/** The four pipeline stages, used to validate the role handed over by env. */
const WORKER_ROLES: readonly ContractWorkerRole[] = ['writer', 'critic', 'implementer', 'verifier'];

/**
 * Reads CONTRACT_PIPELINE_ROLE and narrows it to a known stage.
 *
 * The env var is set by whoever spawned this worker, so it is untrusted
 * input: an unrecognised value must not be written into a stage result as if
 * it were a real stage.
 */
const _pipelineRole = (): ContractWorkerRole | undefined => {
  const raw = process.env.CONTRACT_PIPELINE_ROLE;
  return WORKER_ROLES.find((role) => role === raw);
};

/** Convert model-registry cost (per 1M tokens) to per-token cost. */
const PER_MILLION = 1_000_000;

/** Parse a positive number from env, falling back when unset or malformed. */
const _envNumber = (name: string, fallback: number): number => {
  const parsed = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Parse a boolean env var. Anything but the standard off-values enables. */
const _envBool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
};

/**
 * pi usage objects use `input`/`output`/`cacheRead`/`cacheWrite` field names.
 * Cost is already computed by pi when available; falls back to manual calc.
 */
const _computeTurnCost = (
  usage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
  },
  pricing: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): number => {
  // Prefer pi's built-in cost calculation when available
  if (usage.cost?.total !== undefined && usage.cost.total > 0) {
    return usage.cost.total;
  }

  return (
    (usage.input / PER_MILLION) * pricing.input +
    (usage.output / PER_MILLION) * pricing.output +
    ((usage.cacheRead ?? 0) / PER_MILLION) * (pricing.cacheRead ?? 0) +
    ((usage.cacheWrite ?? 0) / PER_MILLION) * (pricing.cacheWrite ?? 0)
  );
};

/** Flatten an assistant message's content into plain text for analysis. */
const _assistantText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string } | undefined;
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : '';
    })
    .join('');
};

export default function (pi: ExtensionAPI) {
  let sessionCost = 0;
  let hasSoftWarned = false;
  let turnsSincePrompt = 0;
  let sessionStartedAt = Date.now();
  let repetitionStrikes = 0;

  const softCap = Number.parseFloat(process.env.PI_SOFT_SPEND || '10.00');
  const hardCap = Number.parseFloat(process.env.PI_HARD_SPEND || '15.00');
  const maxTurns = _envNumber('PI_MAX_TURNS', 120);
  const maxSessionMs = _envNumber('PI_MAX_SESSION_MINUTES', 45) * 60_000;
  const repetitionGuard = _envBool('PI_REPETITION_GUARD', true);
  const repetitionThreshold = _envNumber('PI_REPETITION_THRESHOLD', 6);

  /**
   * Record a `blocked` stage result so the orchestrator sees a real outcome
   * instead of a worker that simply vanished, then shut the session down.
   *
   * Every guard funnels through here: a pipeline worker killed by any cap
   * must leave the same trace, or the run stalls waiting on a result file
   * that is never written.
   */
  const _halt = async (
    ctx: ExtensionContext,
    options: { summary: string; finding: string },
  ): Promise<void> => {
    ctx.ui.notify(`[COST GUARD] ${options.summary}`, 'error');

    const role = _pipelineRole();
    const resultPath = process.env.CONTRACT_PIPELINE_RESULT_PATH;
    if (role && resultPath) {
      try {
        const { writeStageResult } = await import(
          '../../scripts/src/lib/agents/contract_pipeline/stage_result.ts'
        );
        const runId = process.env.CONTRACT_PIPELINE_RUN_ID;
        const attempt = Number(process.env.CONTRACT_PIPELINE_ATTEMPT);
        if (runId && attempt >= 1) {
          writeStageResult({
            resultPath,
            result: {
              runId,
              stage: role,
              attempt,
              status: 'blocked',
              summary: options.summary,
              findings: [options.finding],
              filesTouched: [],
              evidence: [],
              contractHash: '',
              diffHash: '',
            },
          });
        }
      } catch {
        // If we can't write the result, still shut down
      }
    }

    ctx.shutdown();
  };

  // ── Reset on session start ──────────────────────────────────
  pi.on('session_start', () => {
    sessionCost = 0;
    hasSoftWarned = false;
    turnsSincePrompt = 0;
    sessionStartedAt = Date.now();
    repetitionStrikes = 0;
  });

  // ── Block new agent runs past hard cap ──────────────────────
  pi.on('before_agent_start', async (_event, ctx) => {
    // A fresh human prompt is the only thing that clears the turn budget —
    // steering messages deliberately do not, so a wedged autonomous run
    // cannot reset its own guard by talking to itself.
    turnsSincePrompt = 0;

    if (sessionCost >= hardCap) {
      await _halt(ctx, {
        summary: `Hard limit $${hardCap.toFixed(2)} reached. Spend: $${sessionCost.toFixed(2)}. Session frozen.`,
        finding: 'Cost limit exceeded before stage completion.',
      });
    }
  });

  // ── Track spend at end of each turn ─────────────────────────
  pi.on('turn_end', async (event, ctx) => {
    turnsSincePrompt += 1;

    // ── Repetition collapse: degenerate sampling, not a real loop ──
    if (repetitionGuard) {
      const text = _assistantText((event.message as { content?: unknown }).content);
      const { count, segment } = maxRepeatedSegment(text);
      if (count >= repetitionThreshold) {
        repetitionStrikes += 1;
        const preview = segment.slice(0, 60);

        // Two strikes: one collapsed generation may still recover when the
        // model gets a fresh tool result, but a repeat means it is wedged.
        if (repetitionStrikes >= 2) {
          await _halt(ctx, {
            summary: `Repetition collapse (x${repetitionStrikes}): "${preview}" repeated ${count} times. Shutting down.`,
            finding: 'Model output degenerated into repetition; stage abandoned.',
          });
          return;
        }

        ctx.ui.notify(
          `[COST GUARD] Repetition detected — "${preview}" x${count}. Steering once before halting.`,
          'warning',
        );
        pi.sendUserMessage(
          `[REPETITION GUARD] Your last message repeated the same sentence ${count} times ` +
            `without making progress.\n\n` +
            `Stop. Do not restate your intent again. Either take ONE concrete action with a ` +
            `tool call, or state plainly that you are blocked and what you need to proceed.`,
          { deliverAs: 'steer' },
        );
        return;
      }
    }

    // ── Wall-clock cap ────────────────────────────────────
    const elapsedMs = Date.now() - sessionStartedAt;
    if (elapsedMs >= maxSessionMs) {
      await _halt(ctx, {
        summary: `Session wall-clock limit ${Math.round(maxSessionMs / 60_000)}m reached. Shutting down.`,
        finding: 'Session exceeded its wall-clock budget before completing.',
      });
      return;
    }

    // ── Turn cap ──────────────────────────────────────────
    if (turnsSincePrompt >= maxTurns) {
      await _halt(ctx, {
        summary: `Turn limit ${maxTurns} reached without completing. Shutting down.`,
        finding: `Stage ran ${turnsSincePrompt} turns on one prompt without completing.`,
      });
      return;
    }

    // turn_end.message is the assistant response — it always has usage
    const message = event.message as {
      usage?: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
        cost?: { total?: number };
      };
    };
    const usage = message.usage;
    if (!usage?.input) {
      return;
    }

    const pricing = ctx.model?.cost;
    if (!pricing) {
      return;
    } // No pricing data — can't track cost

    const turnCost = _computeTurnCost(usage, pricing);
    sessionCost += turnCost;

    // ── Hard cap: abort ───────────────────────────────────
    if (sessionCost >= hardCap) {
      await _halt(ctx, {
        summary: `Hard limit $${hardCap.toFixed(2)} hit ($${sessionCost.toFixed(2)} spent). Shutting down.`,
        finding: 'Cost limit exceeded before stage completion.',
      });
      return;
    }

    // ── Soft cap: graceful wrap-up ────────────────────────
    if (sessionCost >= softCap && !hasSoftWarned) {
      hasSoftWarned = true;

      ctx.ui.notify(
        `[COST GUARD] Soft cap $${softCap.toFixed(2)} reached ($${sessionCost.toFixed(2)} spent). Wrapping up…`,
        'warning',
      );

      const role = process.env.CONTRACT_PIPELINE_ROLE;
      const softLimitMsg = role
        ? `[BUDGET SOFT LIMIT — $${softCap.toFixed(2)} reached — $${sessionCost.toFixed(2)} spent]\n\n` +
          `🔴 Contract pipeline ${role}: CALL contract_stage_complete NOW with your current status.\n` +
          `Do not start new work. Summarize what you have and call the completion tool.`
        : `[BUDGET SOFT LIMIT — $${softCap.toFixed(2)} reached — $${sessionCost.toFixed(2)} spent]\n\n` +
          `Wrap up IMMEDIATELY:\n` +
          `1. Stop invoking tools — no more reads, searches, or shell commands.\n` +
          `2. Deliver your final analysis based on what you have.\n` +
          `3. End with "## Unexamined Areas & Next Steps" listing what remains.`;

      pi.sendUserMessage(softLimitMsg, { deliverAs: 'steer' });
    }
  });
}
