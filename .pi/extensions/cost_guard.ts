/**
 * Cost Guard — runaway protection for pi sessions across four axes.
 *
 * 🔴 What a trip COSTS depends on who is watching (see `_isUnattended`):
 *   Unattended pipeline worker — writes a `blocked` stage result and ends the
 *   session, because nobody is there to react and the orchestrator is waiting
 *   on that file.
 *   Interactive session — cancels the in-flight turn and steers. It never
 *   calls `ctx.shutdown()`. A detector can be wrong, and being wrong must not
 *   cost a human their session.
 *
 * Spend:
 *   Soft cap (PI_SOFT_SPEND, default $10): injects a wrap-up message telling
 *   the agent to stop tool calls and deliver a final summary.
 *   Hard cap (PI_HARD_SPEND, default $15): escalates as above.
 *
 * Live interactive controls:
 *   `/budget` shows the current run. `/budget soft|hard <usd>`, `/budget +<usd>`,
 *   and `/budget reset` change the session caps. The command is human-only and
 *   is not registered in unattended pipeline workers. Overrides persist as
 *   non-context custom session entries and are restored on reload/resume.
 *   Resume/reload restores spend by summing persisted usage totals on the
 *   active branch, so restarting cannot reset the spend guard. Run-turn, loop,
 *   cycle, and repetition counters still reset with the new run.
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
 *   PI_SOFT_SPEND            — Initial soft spend cap in USD (default: 10.00)
 *   PI_HARD_SPEND            — Initial hard spend cap in USD (default: 15.00)
 *   PI_MAX_SPEND_CEILING     — Interactive hard-cap ceiling; override with --force (default: 200.00)
 *   PI_MAX_TURNS             — Turns per prompt before a wrap-up steer (default: 1000)
 *   PI_MAX_RUN_MINUTES       — Minutes of one run before a wrap-up steer (default: 240)
 *   PI_REPETITION_GUARD      — Enable repetition collapse detection (default: 1)
 *   PI_REPETITION_THRESHOLD  — Repeats of one segment in TEXT before tripping (default: 6)
 *   PI_THINK_REPETITION_THRESHOLD — Same, for reasoning blocks (default: 50)
 *   PI_LOOP_THRESHOLD        — Identical turns before the loop guard steers (default: 4)
 *   PI_CYCLE_THRESHOLD       — Completed A-B-A-B cycles before steering (default: 3)
 *   PI_STREAM_SCAN_BYTES     — Growth between mid-stream collapse scans (default: 8192)
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ContractWorkerRole } from '../../scripts/src/lib/agents/contract_pipeline/types';
import { runPiScript } from './lib/bridge.ts';
import type { BudgetCaps, BudgetChange } from './lib/budget_state.ts';
import {
  applyBudgetCommand,
  BUDGET_ENTRY_TYPE,
  createPersistedBudget,
  DEFAULT_HARD_CAP,
  DEFAULT_SOFT_CAP,
  DEFAULT_SPEND_CEILING,
  findPersistedBudget,
  parseBudgetCommand,
  restoreSessionSpend,
} from './lib/budget_state.ts';
import {
  assistantText,
  assistantThinking,
  computeTurnCost,
  envBool,
  envNumber,
  toolCalls,
} from './lib/cost_accounting.ts';
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

/**
 * Whether this process is an unattended pipeline worker.
 *
 * 🔴 This is the switch that decides whether a guard may end the session, and
 * it exists because the two contexts fail in OPPOSITE directions.
 *
 * A headless worker has nobody watching. If it wedges it must leave a
 * `blocked` stage result and exit, or the orchestrator waits forever on a
 * file that is never written.
 *
 * An interactive session has a human in it who can read the warning and
 * decide. Ending it destroys context they cannot get back — and every
 * detector here has now produced at least one false positive in practice
 * (2026-08-25: a markdown list label scored as a repetition collapse; the
 * harness storm-breaker read three ENOENTs on three DIFFERENT paths as a
 * tool storm and aborted a review mid-verification). While the detectors can
 * be wrong, the penalty for being wrong has to stay survivable.
 */
const _isUnattended = (): boolean =>
  _pipelineRole() !== undefined && Boolean(process.env.CONTRACT_PIPELINE_RESULT_PATH);

/**
 * Appended to every steer sent to an unattended pipeline worker.
 *
 * 🔴 The generic steers say "state plainly that you are stuck" — advice
 * addressed to a human reader who does not exist in a headless worker. The
 * ONLY exit a pipeline worker has is `contract_stage_complete`; a worker that
 * writes a paragraph instead keeps looping until the halt tier kills it, and
 * the orchestrator gets the guard's guess rather than the worker's verdict.
 * Say the thing that actually ends the stage.
 */
const _pipelineExitInstruction = (): string =>
  _isUnattended()
    ? '\n\nYou are a headless pipeline worker: the ONLY way to end this stage is to call ' +
      '`contract_stage_complete`. Call it NOW — with everything you have verified so far, ' +
      'and status `blocked` if you genuinely cannot proceed. Do not write a summary message ' +
      'instead; nothing reads it.'
    : '';

const _formatUsd = (amount: number): string =>
  `${amount < 0 ? '-' : ''}$${Math.abs(amount).toFixed(2)}`;

/** Interactive recovery instruction for a spend trip. */
const _hardLimitSteer = (spend: number, hardCap: number): string =>
  `[BUDGET HARD LIMIT] This session has spent ${_formatUsd(spend)}, over the ` +
  `${_formatUsd(hardCap)} cap.\n\n` +
  `Do not start new work. Summarise what you have done and what remains, then stop ` +
  `and wait. Run /budget +10 (or /budget hard <usd>) to continue.`;

export default function (pi: ExtensionAPI) {
  let sessionCost = 0;
  // 🔴 Two flags, not one. These guard unrelated conditions, and sharing a
  // single `hasSoftWarned` meant whichever fired first silently suppressed
  // the other for the rest of the session — a long run would warn about its
  // turn budget and then never warn about spend at all.
  let hasSpendWarned = false;
  let hasBudgetWarned = false;
  let turnsSincePrompt = 0;
  let runStartedAt = Date.now();
  let halted = false;
  let haltedForHardLimit = false;
  let repetitionStrikes = 0;
  const loopTracker = createLoopTracker();
  const cycleTracker = createCycleTracker();

  const defaultCaps: BudgetCaps = {
    softCap: envNumber('PI_SOFT_SPEND', DEFAULT_SOFT_CAP),
    hardCap: envNumber('PI_HARD_SPEND', DEFAULT_HARD_CAP),
  };
  let budgetCaps: BudgetCaps = { ...defaultCaps };
  const spendCeiling = envNumber('PI_MAX_SPEND_CEILING', DEFAULT_SPEND_CEILING);
  const maxTurns = envNumber('PI_MAX_TURNS', 1000);
  const maxRunMs = envNumber('PI_MAX_RUN_MINUTES', 240) * 60_000;
  const repetitionGuard = envBool('PI_REPETITION_GUARD', true);
  const repetitionThreshold = envNumber('PI_REPETITION_THRESHOLD', 6);
  // 🔴 Reasoning blocks need their OWN, far higher threshold. The model drafts
  // code in them, and drafting legitimately repeats lines: measured over all
  // 27,783 stored reasoning blocks, healthy turns reach 37 repeats of
  // "```typescript" and 20 of an `if (…) {` line, while every genuine collapse
  // sits at 64+ and is repeated PROSE ("actually, let me reconsider." x547).
  // Reusing the text threshold of 6 here would have halted 44 healthy sessions
  // — one of them at turn 36 of 406 — which is exactly the mistake the turn and
  // time backstops below were already re-calibrated once to undo.
  const thinkRepetitionThreshold = envNumber('PI_THINK_REPETITION_THRESHOLD', 50);
  const loopThreshold = envNumber('PI_LOOP_THRESHOLD', DEFAULT_LOOP_THRESHOLD);
  const cycleThreshold = envNumber('PI_CYCLE_THRESHOLD', DEFAULT_CYCLE_THRESHOLD);
  // How much a streaming message must GROW before it is re-scanned. Bounds the
  // mid-stream check to O(size/step) scans instead of one per token. 8 KB is
  // ~2k tokens: small enough to cut in early, large enough to stay cheap.
  const streamScanBytes = envNumber('PI_STREAM_SCAN_BYTES', 8192);

  /**
   * Escalated response to a guard trip.
   *
   * Unattended (see `_isUnattended`): record a `blocked` stage result so the
   * orchestrator sees a real outcome instead of a worker that simply
   * vanished, then end the session. Every guard funnels through here, so a
   * worker stopped by any cap leaves the same trace.
   *
   * Interactive: cancel the in-flight turn and steer. `ctx.abort()` is enough
   * to stop a runaway generation from burning tokens; `ctx.shutdown()` is
   * what takes the whole session away, and that is never this code's call to
   * make while a human is sitting in front of it.
   */
  const _intervene = async (
    ctx: ExtensionContext,
    options: { summary: string; finding: string; steer: string; hardLimit?: boolean },
  ): Promise<void> => {
    // 🔴 Latch. Without this the trip condition (turns/time/spend stay over
    // their cap) is still true on the NEXT turn, so the guard re-fires every
    // turn forever — the user sees "Shutting down." repeated indefinitely
    // while the session keeps running, which is what happened in practice.
    if (halted) {
      return;
    }
    halted = true;
    haltedForHardLimit = options.hardLimit === true;

    ctx.ui.notify(`[COST GUARD] ${options.summary}`, 'error');

    if (!_isUnattended()) {
      // Cancel the current turn so a runaway generation stops, then hand
      // control back to the human rather than ending their session.
      ctx.abort();
      pi.sendUserMessage(options.steer, { deliverAs: 'steer' });
      return;
    }

    const role = _pipelineRole();
    const resultPath = process.env.CONTRACT_PIPELINE_RESULT_PATH;
    if (role && resultPath) {
      try {
        const runId = process.env.CONTRACT_PIPELINE_RUN_ID;
        const attempt = Number(process.env.CONTRACT_PIPELINE_ATTEMPT);
        const generationValue = Number(process.env.CONTRACT_PIPELINE_GENERATION);
        const generation =
          Number.isSafeInteger(generationValue) && generationValue >= 0
            ? generationValue
            : undefined;
        if (runId && attempt >= 1) {
          await runPiScript('contract.stage.writeResult', {
            resultPath,
            result: {
              runId,
              stage: role,
              attempt,
              generation,
              status: 'blocked',
              summary: options.summary,
              findings: [options.finding],
              filesTouched: [],
              evidence: [],
              contractHash: '',
              diffHash: '',
              // 🔴 Marks this as the GUARD's guess, not the worker's verdict.
              // `ctx.shutdown()` below does not cancel the agent loop that is
              // already in flight, so the worker frequently finishes anyway
              // and overwrites this file seconds later. The orchestrator
              // treats a `haltedBy` result as provisional and waits out a
              // settle window before acting on it (stage_runner.ts,
              // GUARD_SETTLE_MS) — on C-442 the real result, a full pass,
              // landed 60s after this write and was thrown away.
              haltedBy: 'cost_guard',
            },
          });
        }
      } catch {
        // If we can't write the result, still shut down
      }
    }

    // 🔴 abort() first: shutdown() asks pi to exit, but it does NOT cancel the
    // agent loop that is mid-flight, so on its own the session simply carries
    // on to the next turn. abort() is what stops the current operation.
    ctx.abort();
    ctx.shutdown();
  };

  /**
   * Shared response to a detected repetition collapse: steer on the first
   * strike, halt on the second.
   *
   * One collapsed generation can still recover once the model gets a fresh
   * tool result; a second means it is wedged.
   */
  const _onCollapse = async (
    ctx: ExtensionContext,
    options: { count: number; segment: string; midStream: boolean },
  ): Promise<void> => {
    repetitionStrikes += 1;
    const preview = options.segment.slice(0, 60);
    const where = options.midStream ? ' mid-stream' : '';

    if (repetitionStrikes >= 2) {
      await _intervene(ctx, {
        summary: `Repetition collapse${where} (x${repetitionStrikes}): "${preview}" repeated ${options.count} times.`,
        finding: 'Model output degenerated into repetition; stage abandoned.',
        steer:
          `[REPETITION GUARD] Second collapse this run — "${preview}" repeated ` +
          `${options.count} times again after being steered once.\n\n` +
          `Stop generating. Say plainly, in one short paragraph: what you were trying to do, ` +
          `what you have already tried, and what you need in order to proceed. Make no tool ` +
          `calls until the user replies.`,
      });
      return;
    }

    ctx.ui.notify(
      `[COST GUARD] Repetition detected${where} — "${preview}" x${options.count}. Steering once before halting.`,
      'warning',
    );
    // 🔴 Mid-stream the generation is still running, and steering alone does
    // not stop it — abort() is what cancels the in-flight turn. Without this
    // the model keeps emitting until it exhausts maxTokens, which is exactly
    // the wait that made the guard look like it "only fired on abort".
    if (options.midStream) {
      ctx.abort();
    }
    pi.sendUserMessage(
      `[REPETITION GUARD] Your last message repeated the same sentence ${options.count} times ` +
        `without making progress.\n\n` +
        `Stop. Do not restate your intent again. Either take ONE concrete action with a ` +
        `tool call, or state plainly that you are blocked and what you need to proceed.` +
        _pipelineExitInstruction(),
      { deliverAs: 'steer' },
    );
  };

  const _updateBudgetStatus = (ctx: ExtensionContext): void => {
    ctx.ui.setStatus(
      'cost-guard',
      `$${sessionCost.toFixed(1)} / $${budgetCaps.hardCap.toFixed(1)}`,
    );
  };

  const _showBudget = (ctx: ExtensionContext): void => {
    const runMinutes = Math.round((Date.now() - runStartedAt) / 60_000);
    ctx.ui.notify(
      `[BUDGET] Spent ${_formatUsd(sessionCost)} | Soft ${_formatUsd(budgetCaps.softCap)} | ` +
        `Hard ${_formatUsd(budgetCaps.hardCap)} | Remaining ${_formatUsd(budgetCaps.hardCap - sessionCost)} | ` +
        `Turns ${turnsSincePrompt} | Run ${runMinutes}m`,
      'info',
    );
    _updateBudgetStatus(ctx);
  };

  const _budgetChangeMessage = (change: BudgetChange): string => {
    const notices = [
      change.hardAutoRaised ? 'Hard cap auto-raised to match soft.' : '',
      change.hardAtOrBelowSpend
        ? 'Hard cap is still at or below spend; the next prompt remains blocked.'
        : '',
    ].filter(Boolean);
    const summary =
      `[BUDGET] Soft ${_formatUsd(change.before.softCap)} → ${_formatUsd(change.after.softCap)}; ` +
      `hard ${_formatUsd(change.before.hardCap)} → ${_formatUsd(change.after.hardCap)}; ` +
      `remaining ${_formatUsd(change.remainingHeadroom)}.`;
    return notices.length ? `${summary} ${notices.join(' ')}` : summary;
  };

  const _runBudgetCommand = async (rawArgs: string, ctx: ExtensionContext): Promise<void> => {
    if (_isUnattended()) {
      ctx.ui.notify('[BUDGET] Overrides are disabled in unattended pipeline workers.', 'warning');
      return;
    }
    const parsed = parseBudgetCommand(rawArgs);
    if (!parsed.ok) {
      ctx.ui.notify(`[BUDGET] ${parsed.error}`, 'error');
      return;
    }
    if (parsed.command.action === 'show') {
      _showBudget(ctx);
      return;
    }

    const result = applyBudgetCommand({
      command: parsed.command,
      current: budgetCaps,
      defaults: defaultCaps,
      ceiling: spendCeiling,
      spend: sessionCost,
    });
    if (!result.ok) {
      ctx.ui.notify(`[BUDGET] ${result.error}`, 'error');
      return;
    }

    budgetCaps = result.change.after;
    if (result.change.rearmHard && haltedForHardLimit) {
      halted = false;
      haltedForHardLimit = false;
    }
    if (result.change.rearmSoft) {
      hasSpendWarned = false;
    }
    pi.appendEntry(BUDGET_ENTRY_TYPE, createPersistedBudget(budgetCaps));
    _updateBudgetStatus(ctx);
    ctx.ui.notify(
      _budgetChangeMessage(result.change),
      result.change.hardAtOrBelowSpend ? 'warning' : 'info',
    );
  };

  // A slash command is dispatched only from user input. Model output is never
  // parsed as budget syntax, and no model-callable tool is registered.
  if (!_isUnattended()) {
    pi.registerCommand('budget', {
      description: 'Show or change this session spend caps',
      getArgumentCompletions: (prefix) => {
        const completions = ['soft', 'hard', 'reset', '+10'].filter((value) =>
          value.startsWith(prefix),
        );
        return completions.length ? completions.map((value) => ({ value, label: value })) : null;
      },
      handler: async (args, ctx) => _runBudgetCommand(args, ctx),
    });
  }

  // ── Mid-stream collapse detection ───────────────────────────────────
  //
  // 🔴 `turn_end` fires only once the turn is COMPLETE. A collapsing turn
  // streams reasoning until it exhausts maxTokens, so every post-turn check
  // is blind for as long as that takes — on 2026-08-23 a turn reached 298,477
  // characters, and the user's own Ctrl+C is what ended it. The guard then
  // dutifully reported "x192" to a session that was already dead. Reading the
  // partial message as it streams is the only way to cut in before that.
  //
  // Throttled by growth, not by update count: `message_update` fires per
  // token, and re-scanning the whole buffer each time would be quadratic.
  let scannedAt = 0;
  // Whether the message currently streaming already took a collapse strike.
  // Without this the aborted partial reaches `turn_end`, is scored a second
  // time, and the FIRST collapse halts the session instead of steering it.
  let streamStruck = false;
  pi.on('message_update', async (event, ctx) => {
    if (!repetitionGuard || halted || streamStruck) {
      return;
    }
    const partial = (event.message as { role?: string; content?: unknown } | undefined) ?? {};
    if (partial.role !== 'assistant') {
      return;
    }
    const thinking = assistantThinking(partial.content);
    const text = assistantText(partial.content);
    const size = thinking.length + text.length;
    if (size < scannedAt + streamScanBytes) {
      return;
    }
    scannedAt = size;

    const inThinking = maxRepeatedSegment(thinking);
    const inText = maxRepeatedSegment(text);
    if (inThinking.count >= thinkRepetitionThreshold || inText.count >= repetitionThreshold) {
      const worst = inThinking.count > inText.count ? inThinking : inText;
      streamStruck = true;
      await _onCollapse(ctx, { count: worst.count, segment: worst.segment, midStream: true });
    }
  });

  pi.on('message_start', () => {
    scannedAt = 0;
    streamStruck = false;
  });

  // ── Reset run state and restore session-scoped budget ───────────────
  pi.on('session_start', (_event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    budgetCaps = findPersistedBudget(branch) ?? { ...defaultCaps };
    sessionCost = restoreSessionSpend(branch);
    hasSpendWarned = false;
    hasBudgetWarned = false;
    turnsSincePrompt = 0;
    runStartedAt = Date.now();
    halted = false;
    haltedForHardLimit = false;
    repetitionStrikes = 0;
    loopTracker.reset();
    cycleTracker.reset();
    _updateBudgetStatus(ctx);
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
    haltedForHardLimit = false;
    _updateBudgetStatus(ctx);

    if (sessionCost >= budgetCaps.hardCap) {
      await _intervene(ctx, {
        summary: `Hard limit ${_formatUsd(budgetCaps.hardCap)} reached. Spend: ${_formatUsd(sessionCost)}.`,
        finding: 'Cost limit exceeded before stage completion.',
        steer: _hardLimitSteer(sessionCost, budgetCaps.hardCap),
        hardLimit: true,
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
      sessionCost += computeTurnCost(usage, pricing);
    }
    _updateBudgetStatus(ctx);

    // ── Hard cap: abort ───────────────────────────────────
    // Accounted before the repetition branches so repeated turns still update
    // sessionCost and are checked against the cap before steering or halting.
    if (sessionCost >= budgetCaps.hardCap) {
      await _intervene(ctx, {
        summary: `Hard limit ${_formatUsd(budgetCaps.hardCap)} hit (${_formatUsd(sessionCost)} spent).`,
        finding: 'Cost limit exceeded before stage completion.',
        steer: _hardLimitSteer(sessionCost, budgetCaps.hardCap),
        hardLimit: true,
      });
      return;
    }

    // ── Cross-turn loop: the same turn, repeated verbatim ──
    //
    // Distinct from the collapse check below, which only sees inside a single
    // message. Both known cases here had EMPTY text and repeated only their
    // tool call, so text analysis alone scores them zero.
    const thinking = repetitionGuard ? assistantThinking(content) : '';

    if (repetitionGuard) {
      const signature = turnSignature({
        text: assistantText(content),
        toolCalls: toolCalls(content),
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
        await _intervene(ctx, {
          summary:
            `Loop detected: ${cycle.period} actions repeating as a cycle, ` +
            `${cycle.cycles} times over.`,
          finding: `Agent repeated a ${cycle.period}-step cycle ${cycle.cycles} times without progressing.`,
          steer:
            `[LOOP GUARD] You have now run the same ${cycle.period}-step sequence ` +
            `${cycle.cycles} times with identical arguments, including after being steered.\n\n` +
            `Stop. Make no further tool calls. State plainly what you are trying to establish, ` +
            `what these repeated calls have returned, and what you need in order to move on.`,
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
            `arguments differ from everything above.` +
            _pipelineExitInstruction(),
          { deliverAs: 'steer' },
        );
        return;
      }

      if (run >= loopThreshold * 2) {
        await _intervene(ctx, {
          summary: `Loop detected: the same turn repeated ${run} times.`,
          finding: `Agent repeated an identical turn ${run} times without progressing.`,
          steer:
            `[LOOP GUARD] You have repeated an identical turn ${run} times, including after ` +
            `being steered once.\n\n` +
            `Stop. Make no further tool calls. State plainly what you are trying to establish, ` +
            `what this call keeps returning, and what you need in order to move on.`,
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
            `plainly that you are stuck, what you have already tried, and what you need.` +
            _pipelineExitInstruction(),
          { deliverAs: 'steer' },
        );
        return;
      }
    }

    // ── Repetition collapse: degenerate sampling, not a real loop ──
    if (repetitionGuard) {
      const text = assistantText(content);
      const inText = maxRepeatedSegment(text);
      const inThinking = maxRepeatedSegment(thinking);
      // Each stream is judged against its own threshold, then the worse one
      // is reported — reasoning tolerates far more repetition than prose.
      const tripped =
        inText.count >= repetitionThreshold || inThinking.count >= thinkRepetitionThreshold;
      const { count, segment } = inThinking.count > inText.count ? inThinking : inText;
      if (tripped && !streamStruck) {
        await _onCollapse(ctx, { count, segment, midStream: false });
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
    // 🔴 There is no halt tier here any more. It used to fire at 1.5x these
    // caps (1500 turns / 360m); measured over all 1065 stored runs it would
    // have fired on exactly ONE — the 2026-08-17 C-418 implementer — and the
    // loop guard already catches that run at 8 identical turns, hours before
    // a turn counter could. Dead code that can only ever misfire.
    const runMs = Date.now() - runStartedAt;

    if ((runMs >= maxRunMs || turnsSincePrompt >= maxTurns) && !hasBudgetWarned) {
      hasBudgetWarned = true;
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
    if (sessionCost >= budgetCaps.softCap && !hasSpendWarned) {
      hasSpendWarned = true;

      ctx.ui.notify(
        `[COST GUARD] Soft cap ${_formatUsd(budgetCaps.softCap)} reached (${_formatUsd(sessionCost)} spent). Wrapping up…`,
        'warning',
      );

      const role = process.env.CONTRACT_PIPELINE_ROLE;
      const softLimitMsg = role
        ? `[BUDGET SOFT LIMIT — ${_formatUsd(budgetCaps.softCap)} reached — ${_formatUsd(sessionCost)} spent]\n\n` +
          `🔴 Contract pipeline ${role}: CALL contract_stage_complete NOW with your current status.\n` +
          `Do not start new work. Summarize what you have and call the completion tool.`
        : `[BUDGET SOFT LIMIT — ${_formatUsd(budgetCaps.softCap)} reached — ${_formatUsd(sessionCost)} spent]\n\n` +
          `Wrap up IMMEDIATELY:\n` +
          `1. Stop invoking tools — no more reads, searches, or shell commands.\n` +
          `2. Deliver your final analysis based on what you have.\n` +
          `3. End with "## Unexamined Areas & Next Steps" listing what remains.`;

      pi.sendUserMessage(softLimitMsg, { deliverAs: 'steer' });
    }
  });
}
