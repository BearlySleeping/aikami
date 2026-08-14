/**
 * Cost Guard — two-stage budget protection for pi sessions.
 *
 * Soft cap (PI_SOFT_SPEND, default $10): injects a wrap-up message telling
 * the agent to stop tool calls and deliver a final summary.
 *
 * Hard cap (PI_HARD_SPEND, default $15): shuts down the session to prevent
 * runaway spend.
 *
 * Pricing is read from pi's model registry at runtime (ctx.model.cost).
 * No hardcoded prices — always reflects the user's model catalog.
 *
 * Environment variables:
 *   PI_SOFT_SPEND  — Soft cap in USD (default: 10.00)
 *   PI_HARD_SPEND  — Hard cap in USD (default: 15.00)
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Convert model-registry cost (per 1M tokens) to per-token cost. */
const PER_MILLION = 1_000_000;

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

export default function (pi: ExtensionAPI) {
  let sessionCost = 0;
  let hasSoftWarned = false;

  const softCap = Number.parseFloat(process.env.PI_SOFT_SPEND || '10.00');
  const hardCap = Number.parseFloat(process.env.PI_HARD_SPEND || '15.00');

  // ── Reset on session start ──────────────────────────────────
  pi.on('session_start', () => {
    sessionCost = 0;
    hasSoftWarned = false;
  });

  // ── Block new agent runs past hard cap ──────────────────────
  pi.on('before_agent_start', async (_event, ctx) => {
    if (sessionCost >= hardCap) {
      ctx.ui.notify(
        `[COST GUARD] Hard limit $${hardCap.toFixed(2)} reached. Spend: $${sessionCost.toFixed(2)}. Session frozen.`,
        'error',
      );
      // For contract pipeline workers: write a blocked result before shutdown
      const role = process.env.CONTRACT_PIPELINE_ROLE;
      const resultPath = process.env.CONTRACT_PIPELINE_RESULT_PATH;
      if (role && resultPath) {
        try {
          const { writeStageResult } = await import('../../scripts/src/lib/agents/contract_pipeline/stage_result.ts');
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
                summary: `Cost guard hard limit reached ($${hardCap.toFixed(2)}). Pipeline stopped.`,
                findings: ['Cost limit exceeded before stage completion.'],
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
    }
  });

  // ── Track spend at end of each turn ─────────────────────────
  pi.on('turn_end', async (event, ctx) => {
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
      ctx.ui.notify(
        `[COST GUARD] Hard limit $${hardCap.toFixed(2)} hit ($${sessionCost.toFixed(2)} spent). Shutting down.`,
        'error',
      );
      ctx.shutdown();
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
      const message = role
        ? `[BUDGET SOFT LIMIT — $${softCap.toFixed(2)} reached — $${sessionCost.toFixed(2)} spent]\n\n` +
          `🔴 Contract pipeline ${role}: CALL contract_stage_complete NOW with your current status.\n` +
          `Do not start new work. Summarize what you have and call the completion tool.`
        : `[BUDGET SOFT LIMIT — $${softCap.toFixed(2)} reached — $${sessionCost.toFixed(2)} spent]\n\n` +
          `Wrap up IMMEDIATELY:\n` +
          `1. Stop invoking tools — no more reads, searches, or shell commands.\n` +
          `2. Deliver your final analysis based on what you have.\n` +
          `3. End with "## Unexamined Areas & Next Steps" listing what remains.`;

      pi.sendUserMessage(message, { deliverAs: 'steer' });
    }
  });
}
