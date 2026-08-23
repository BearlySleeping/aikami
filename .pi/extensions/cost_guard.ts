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
 *   PI_MAX_TURNS             — Max assistant turns per user prompt (default: 1000)
 *   PI_MAX_RUN_MINUTES       — Max minutes of one autonomous run (default: 240)
 *   PI_REPETITION_GUARD      — Enable repetition collapse detection (default: 1)
 *   PI_REPETITION_THRESHOLD  — Repeats of one segment in TEXT before tripping (default: 6)
 *   PI_THINK_REPETITION_THRESHOLD — Same, for reasoning blocks (default: 50)
 *   PI_LOOP_THRESHOLD        — Identical turns before the loop guard steers (default: 4)
 *   PI_CYCLE_THRESHOLD       — Completed A-B-A-B cycles before steering (default: 3)
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ContractWorkerRole } from '../../scripts/src/lib/agents/contract_pipeline/types';
import {
  createCycleTracker,
  createLoopTracker,
  DEFAULT_CYCLE_THRESHOLD,
  DEFAULT_LOOP_THRESHOLD,
  maxRepeatedSegment,
  turnSignature,
} from './lib/repetition.ts';

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
  const parsed = Number(process.env[name] ?? '');
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
    .join('\n');
};

/**
 * Flatten an assistant message's REASONING blocks into plain text.
 *
 * 🔴 On DeepSeek this is where all the narration lives: across the 285 stored
 * sessions there are 27,783 `thinking` blocks against 18,113 `text` blocks,
 * and every degenerate turn on record had `text` completely empty. A collapse
 * check that reads only `text` therefore scores the worst turns zero — the
 * 2026-08-23 session emitted 169,607 characters of reasoning repeating one
 * sentence 177 times while `_assistantText` saw the empty string.
 */
const _assistantThinking = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      const b = block as { type?: string; thinking?: string; text?: string } | undefined;
      if (b?.type !== 'thinking' && b?.type !== 'reasoning') {
        return '';
      }
      return b.thinking ?? b.text ?? '';
    })
    .join('\n');
};

/** Extract an assistant message's tool calls for loop-signature purposes. */
const _toolCalls = (content: unknown): { name: string; arguments: unknown }[] => {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((block) => (block as { type?: string } | undefined)?.type === 'toolCall')
    .map((block) => {
      const b = block as { name?: string; arguments?: unknown };
      return { name: b.name ?? '', arguments: b.arguments };
    });
};

export default function (pi: ExtensionAPI) {
  let sessionCost = 0;
  let hasSoftWarned = false;
  let turnsSincePrompt = 0;
  let runStartedAt = Date.now();
  let halted = false;
  let repetitionStrikes = 0;
  const loopTracker = createLoopTracker();
  const cycleTracker = createCycleTracker();

  const softCap = _envNumber('PI_SOFT_SPEND', 10.0);
  const hardCap = _envNumber('PI_HARD_SPEND', 15.0);
  const maxTurns = _envNumber('PI_MAX_TURNS', 1000);
  const maxRunMs = _envNumber('PI_MAX_RUN_MINUTES', 240) * 60_000;
  const repetitionGuard = _envBool('PI_REPETITION_GUARD', true);
  const repetitionThreshold = _envNumber('PI_REPETITION_THRESHOLD', 6);
  // 🔴 Reasoning blocks need their OWN, far higher threshold. The model drafts
  // code in them, and drafting legitimately repeats lines: measured over all
  // 27,783 stored reasoning blocks, healthy turns reach 37 repeats of
  // "```typescript" and 20 of an `if (…) {` line, while every genuine collapse
  // sits at 64+ and is repeated PROSE ("actually, let me reconsider." x547).
  // Reusing the text threshold of 6 here would have halted 44 healthy sessions
  // — one of them at turn 36 of 406 — which is exactly the mistake the turn and
  // time backstops below were already re-calibrated once to undo.
  const thinkRepetitionThreshold = _envNumber('PI_THINK_REPETITION_THRESHOLD', 50);
  const loopThreshold = _envNumber('PI_LOOP_THRESHOLD', DEFAULT_LOOP_THRESHOLD);
  const cycleThreshold = _envNumber('PI_CYCLE_THRESHOLD', DEFAULT_CYCLE_THRESHOLD);

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
    // 🔴 Latch. Without this the trip condition (turns/time/spend stay over
    // their cap) is still true on the NEXT turn, so the guard re-fires every
    // turn forever — the user sees "Shutting down." repeated indefinitely
    // while the session keeps running, which is what happened in practice.
    if (halted) {
      return;
    }
    halted = true;

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

    // 🔴 abort() first: shutdown() asks pi to exit, but it does NOT cancel the
    // agent loop that is mid-flight, so on its own the session simply carries
    // on to the next turn. abort() is what stops the current operation — the
    // same call storm-breaker uses to break out of a run.
    ctx.abort();
    ctx.shutdown();
  };

  // ── Reset on session start ──────────────────────────────────
  pi.on('session_start', () => {
    sessionCost = 0;
    hasSoftWarned = false;
    turnsSincePrompt = 0;
    runStartedAt = Date.now();
    halted = false;
    repetitionStrikes = 0;
    loopTracker.reset();
    cycleTracker.reset();
  });

  // ── Block new agent runs past hard cap ──────────────────────
  pi.on('before_agent_start', async (_event, ctx) => {
    // A fresh human prompt is the only thing that clears the turn budget —
    // steering messages deliberately do not, so a wedged autonomous run
    // cannot reset its own guard by talking to itself.
    turnsSincePrompt = 0;
    runStartedAt = Date.now();
    loopTracker.reset();
    cycleTracker.reset();
    // Re-arm: a fresh human prompt is a new run with a new budget, so a guard
    // that tripped on the previous run must be able to trip again on this one.
    halted = false;

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
    const content = (event.message as { content?: unknown }).content;

    const message = event.message as {
      usage?: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
        cost?: { total?: number };
      };
    };

    // ── Spend accounting is BEST-EFFORT and must not gate the guards ──────
    //
    // 🔴 This used to be `if (!usage?.input) return;` above everything else,
    // which made a missing usage record silently disable loop, cycle and
    // collapse detection for that turn. An aborted or interrupted turn
    // reports no usage — and those are precisely the turns a wedged run
    // produces. In the 2026-08-23 session both degenerate turns (#148 and
    // the 169KB collapse at #172) carried `input: 0`, so every guard was
    // skipped on the only two turns that mattered.
    const usage = message.usage;
    const pricing = ctx.model?.cost;
    if (usage?.input && pricing) {
      sessionCost += _computeTurnCost(usage, pricing);
    }

    // ── Hard cap: abort ───────────────────────────────────
    // Accounted before the repetition branches so repeated turns still update
    // sessionCost and are checked against the cap before steering or halting.
    if (sessionCost >= hardCap) {
      await _halt(ctx, {
        summary: `Hard limit $${hardCap.toFixed(2)} hit ($${sessionCost.toFixed(2)} spent). Shutting down.`,
        finding: 'Cost limit exceeded before stage completion.',
      });
      return;
    }

    // ── Cross-turn loop: the same turn, repeated verbatim ──
    //
    // Distinct from the collapse check below, which only sees inside a single
    // message. Both known cases here had EMPTY text and repeated only their
    // tool call, so text analysis alone scores them zero.
    const thinking = repetitionGuard ? _assistantThinking(content) : '';

    if (repetitionGuard) {
      const signature = turnSignature({
        text: _assistantText(content),
        toolCalls: _toolCalls(content),
        thinking,
      });
      const run = loopTracker.record(signature);

      // ── Multi-step cycle: A B A B, which the run counter cannot see ──
      //
      // Checked BEFORE the period-1 branches because a steered period-1 loop
      // degrades into one: on 2026-08-23 the loop guard steered at 4 repeats
      // of a `read`, the model took "do something materially different"
      // literally and started alternating two calls, and ran that pair for
      // 26 cycles over 12 minutes with byte-identical arguments before the
      // user gave up and interrupted it. `run` never exceeded 1 throughout.
      const cycle = cycleTracker.record(signature);
      if (cycle && cycle.cycles >= cycleThreshold * 2) {
        await _halt(ctx, {
          summary:
            `Loop detected: ${cycle.period} actions repeating as a cycle, ` +
            `${cycle.cycles} times over. Shutting down.`,
          finding: `Agent repeated a ${cycle.period}-step cycle ${cycle.cycles} times without progressing.`,
        });
        return;
      }
      if (cycle && cycle.cycles === cycleThreshold) {
        ctx.ui.notify(
          `[COST GUARD] Cycle detected — ${cycle.period} actions repeating x${cycle.cycles}. Steering before halting.`,
          'warning',
        );
        pi.sendUserMessage(
          `[LOOP GUARD] You have repeated the same ${cycle.period}-step sequence of actions ` +
            `${cycle.cycles} times, with identical arguments each time, and the results have not changed.\n\n` +
            `Alternating between two actions is still a loop. Stop. Either state plainly that ` +
            `you are stuck — what you have tried and what you need — or take an action whose ` +
            `arguments differ from everything above.`,
          { deliverAs: 'steer' },
        );
        return;
      }

      if (run >= loopThreshold * 2) {
        await _halt(ctx, {
          summary: `Loop detected: the same turn repeated ${run} times. Shutting down.`,
          finding: `Agent repeated an identical turn ${run} times without progressing.`,
        });
        return;
      }

      if (run === loopThreshold) {
        ctx.ui.notify(
          `[COST GUARD] Loop detected — identical turn x${run}. Steering before halting.`,
          'warning',
        );
        pi.sendUserMessage(
          `[LOOP GUARD] You have repeated the same action ${run} times in a row with ` +
            `identical arguments, and the result has not changed.\n\n` +
            `Stop repeating it. Either do something materially different, or state ` +
            `plainly that you are stuck, what you have already tried, and what you need.`,
          { deliverAs: 'steer' },
        );
        return;
      }
    }

    // ── Repetition collapse: degenerate sampling, not a real loop ──
    if (repetitionGuard) {
      const text = _assistantText(content);
      const inText = maxRepeatedSegment(text);
      const inThinking = maxRepeatedSegment(thinking);
      // Each stream is judged against its own threshold, then the worse one
      // is reported — reasoning tolerates far more repetition than prose.
      const tripped =
        inText.count >= repetitionThreshold || inThinking.count >= thinkRepetitionThreshold;
      const { count, segment } = inThinking.count > inText.count ? inThinking : inText;
      if (tripped) {
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

    // ── Backstops: turns and active run time ──────────────
    //
    // 🔴 These are LAST-RESORT bounds, not the primary defence — the loop and
    // collapse checks above are. Their defaults are measured against all 289
    // stored sessions rather than guessed, because guessed ones were far too
    // tight and killed healthy work:
    //
    //   turns per prompt   p50=45  p90=217  p95=322  p99=743  legit max=821
    //                      (a 120 cap would have killed 23% of real sessions)
    //   active run minutes p50=3   p90=25   p95=41   p99=74   legit max=247
    //                      (a 45m cap would have killed 34% of real sessions)
    //
    // Run time is measured from the last user prompt with per-turn gaps capped
    // upstream, NOT from session start: a session left open overnight is idle,
    // not runaway, and the longest sessions on record are 36h of sitting idle.
    //
    // Each backstop wraps up first and only halts if the agent ignores that.
    const runMs = Date.now() - runStartedAt;

    if (runMs >= maxRunMs * 1.5 || turnsSincePrompt >= maxTurns * 1.5) {
      await _halt(ctx, {
        summary:
          `Backstop: ${turnsSincePrompt} turns / ${Math.round(runMs / 60_000)}m active ` +
          `without completing. Shutting down.`,
        finding: `Run exceeded its turn and time budget (${turnsSincePrompt} turns, ${Math.round(runMs / 60_000)}m).`,
      });
      return;
    }

    if ((runMs >= maxRunMs || turnsSincePrompt >= maxTurns) && !hasSoftWarned) {
      hasSoftWarned = true;
      ctx.ui.notify(
        `[COST GUARD] Backstop: ${turnsSincePrompt} turns / ${Math.round(runMs / 60_000)}m active. Wrapping up…`,
        'warning',
      );
      pi.sendUserMessage(
        `[RUN BUDGET] This run has used ${turnsSincePrompt} turns over ` +
          `${Math.round(runMs / 60_000)} minutes without finishing.\n\n` +
          `Wrap up now: stop starting new work, summarise what you have done and ` +
          `what remains, and finish the turn.`,
        { deliverAs: 'steer' },
      );
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
