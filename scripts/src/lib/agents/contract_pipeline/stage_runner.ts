// scripts/src/lib/agents/contract_pipeline/stage_runner.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackMessage, loadRolePrompt } from './prompt_loader.ts';
import { isGuardHalt, readStageResult, writeStageResult } from './stage_result.ts';
import type {
  ContractPipelineStage,
  ContractStageResult,
  ContractWorkerRole,
  StageRunOutcome,
  WorkerLaunchRequest,
} from './types.ts';

const STAGE_ROLES = {
  write_contract: 'writer',
  critique: 'critic',
  implement: 'implementer',
  verify: 'verifier',
} as const satisfies Partial<Record<ContractPipelineStage, ContractWorkerRole>>;

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Continuous idle time before the worker gets a nudge to call contract_stage_complete. */
const NUDGE_AFTER_IDLE_MS = 2 * 60 * 1000;
/** Maximum nudges before allowing continuous idle to reach the idle timeout. */
const MAX_NUDGES = 3;
/** After idle timeout, detect truly dead processes within this grace period before slow-poll. */
const DEAD_CHECK_GRACE_MS = 5 * 1000;
/** Maximum relaunch attempts when worker process dies unexpectedly. */
const MAX_RELAUNCHES = 2;
/** Slow-poll interval after idle timeout (longer to avoid herdr spam). */
const SLOW_POLL_MS = 30_000;

/**
 * How long a supervisor-written (`haltedBy`) result stays PROVISIONAL before
 * the orchestrator acts on it.
 *
 * 🔴 A guard halt is written from inside the worker session at the moment a
 * detector trips — but `ctx.shutdown()` does not cancel the agent loop that
 * is already mid-flight, so the worker very often finishes anyway and writes
 * its own real verdict over the guess seconds later.
 *
 * C-442 (2026-08-26) is the case this exists for: the loop guard halted the
 * verifier at 13:57:10 with `blocked — the same turn repeated 10 times`, the
 * orchestrator consumed it instantly and went terminal, and at 13:58 the same
 * session wrote `passed` with all 7 ACs verified into the very same file.
 * A completed verification was discarded on a 50-second race.
 *
 * Three minutes of waiting on a run that is otherwise about to be thrown away
 * is the cheapest insurance in the pipeline.
 */
export const GUARD_SETTLE_MS: number = Number(process.env.CONTRACT_GUARD_SETTLE_MS) || 3 * 60_000;

/** Re-read interval while waiting out {@link GUARD_SETTLE_MS}. */
const GUARD_SETTLE_POLL_MS = 5_000;

/**
 * Wait out the settle window on a provisional guard result, adopting the
 * worker's own verdict if it lands.
 *
 * Returns the provisional result unchanged when nothing better arrives, so
 * the caller's control flow is identical either way.
 */
const settleGuardResult = async (options: {
  provisional: ContractStageResult;
  resultPath: string;
  runId: string;
  role: ContractWorkerRole;
  attempt: number;
  settleMs?: number;
}): Promise<ContractStageResult> => {
  const settleMs = options.settleMs ?? GUARD_SETTLE_MS;
  if (settleMs <= 0) {
    return options.provisional;
  }
  console.warn(
    `⏸️  ${options.role} was halted by ${options.provisional.haltedBy} ` +
      `("${options.provisional.summary.slice(0, 120)}"). Treating as provisional and ` +
      `waiting up to ${settleMs < 1000 ? `${settleMs}ms` : `${Math.round(settleMs / 1000)}s`} ` +
      `for the worker's own verdict…`,
  );
  // Scaled so a short test window is not swallowed by a single long sleep.
  const pollMs = Math.max(25, Math.min(GUARD_SETTLE_POLL_MS, Math.floor(settleMs / 10)));
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const current = readStageResult({
      resultPath: options.resultPath,
      runId: options.runId,
      role: options.role,
      attempt: options.attempt,
    });
    if (current && !isGuardHalt(current)) {
      console.log(
        `✅ ${options.role} finished after the halt — adopting its own result (${current.status}) ` +
          `over the ${options.provisional.haltedBy} guess.`,
      );
      return current;
    }
  }
  console.warn(
    `⛔ ${options.role} produced no verdict within the settle window — the ` +
      `${options.provisional.haltedBy} halt stands.`,
  );
  return options.provisional;
};

/** Return the worker role for a model-driven stage. */
export const roleForStage = (stage: ContractPipelineStage): ContractWorkerRole => {
  const role = STAGE_ROLES[stage as keyof typeof STAGE_ROLES];
  if (!role) {
    throw new Error(`Stage ${stage} does not have a worker role.`);
  }
  return role;
};

/**
 * Run one worker stage and accept only its exact structured result artifact.
 *
 * Timeout model:
 * - While the agent is actively working (herdr agent_status === 'working'),
 *   NO timeout accrues — an actively working pi session is never killed.
 * - Continuous idle time triggers nudges, then blocks after `idleTimeoutMs`.
 * - `hardTimeoutMs` is a generous wall-clock safety net for cases where
 *   the agent status is unobservable (herdr unreachable → assumed working).
 */
export const runStage = async (options: {
  repoRoot: string;
  runDirectory: string;
  runId: string;
  stage: ContractPipelineStage;
  attempt: number;
  contractPath: string;
  idleTimeoutMs: number;
  hardTimeoutMs: number;
  pollIntervalMs?: number;
  /** Override the provisional-result settle window. Tests pass 0. */
  guardSettleMs?: number;
  feedback?: string;
  /**
   * Status the orchestrator ALREADY recorded in the run manifest for attempt
   * `attempt - 1` of this stage, when it has one.
   *
   * 🔴 This is what separates the two situations the retry safeguard below
   * cannot otherwise tell apart. See its comment for why `passed` here must
   * block adoption.
   */
  previousAttemptRecordedStatus?: ContractStageResult['status'];
  /** True for the interactive writer stage (direct draft). The agent waits
   *  for the user's description in the chat — loadRolePrompt gets the wait
   *  instructions and the task brief path. */
  interactiveWriter?: boolean;
  launchWorker: (request: WorkerLaunchRequest) => Promise<{ paneId: string }>;
  checkAgentWorking?: (paneId: string) => Promise<boolean>;
  nudgeWorker?: (opts: { paneId: string; message: string }) => Promise<void>;
  /** Generation counter for result fencing — passed through to WorkerLaunchRequest. */
  generation?: number;
}): Promise<StageRunOutcome> => {
  const role = roleForStage(options.stage);
  const resultPath = join(
    options.runDirectory,
    'stages',
    `${options.stage}-${options.attempt}.json`,
  );

  const orphaned = readStageResult({
    resultPath,
    runId: options.runId,
    role,
    attempt: options.attempt,
  });
  if (orphaned) {
    console.log(`♻️  Adopting completed ${role} result from prior run (${orphaned.status}).`);
    return { result: orphaned, paneId: 'recovered' };
  }

  // 🔴 RETRY SAFEGUARD: check previous attempt's result file too.
  // If the worker finished after the orchestrator timed out, the previous
  // attempt's result file will be valid. Adopt it and skip re-work.
  //
  // 🔴 …but ONLY when the orchestrator did not already act on that result.
  //
  // Two situations produce "attempt N, and attempt N-1's file says passed",
  // and they need opposite handling:
  //
  //   (a) LATE WORKER — attempt N-1 hard-timed-out, the orchestrator recorded
  //       `blocked`, and the worker then finished and overwrote the file with
  //       a real `passed`. Re-running would throw away completed work.
  //       ADOPT. This is the case the safeguard was written for.
  //
  //   (b) DELIBERATE NEW ROUND — attempt N-1 genuinely passed, the
  //       orchestrator consumed it, the verifier or review captain then asked
  //       for changes, and the pipeline came back for another pass.
  //       MUST NOT ADOPT.
  //
  // Adopting in case (b) is what broke run-mssulnwd-C-390: implement-2's
  // result was copied forward into implement-3, -4, -5 and -6 byte for byte
  // (only `attempt` differed), so the implementer was never launched again.
  // Every round instantly "passed", the verifier re-found the same defects,
  // and the run burned four implement→verify→review cycles in 45 seconds
  // without a single line of code changing. The review captain's handoff —
  // and the user's request to pass Claude's comments to the implementer —
  // could not possibly take effect, because no implementer ever ran.
  //
  // The manifest is the discriminator: a `passed` there means the pipeline
  // already moved on, so this attempt is a new round and must do real work.
  const previousAlreadyConsumed = options.previousAttemptRecordedStatus === 'passed';
  if (options.attempt > 1 && !previousAlreadyConsumed) {
    const prevPath = join(
      options.runDirectory,
      'stages',
      `${options.stage}-${options.attempt - 1}.json`,
    );
    const prevResult = readStageResult({
      resultPath: prevPath,
      runId: options.runId,
      role,
      attempt: options.attempt - 1,
    });
    if (prevResult && prevResult.status === 'passed') {
      console.log(
        `♻️  Adopting previous attempt's passed result for ${role} (attempt ${options.attempt - 1} → ${options.attempt}).`,
      );
      // Write it as the current attempt's result too.
      writeStageResult({
        resultPath,
        result: { ...prevResult, attempt: options.attempt },
      });
      return { result: { ...prevResult, attempt: options.attempt }, paneId: 'recovered-prev' };
    }
  }

  if (existsSync(resultPath)) {
    unlinkSync(resultPath);
  }

  const prompt = loadRolePrompt({
    role,
    contractPath: options.contractPath,
    repoRoot: options.repoRoot,
    interactiveWriter: options.interactiveWriter,
    taskBriefPath: options.interactiveWriter
      ? join(options.runDirectory, 'prompts', `${options.stage}-${options.attempt}-task.md`)
      : undefined,
  });
  const userMessage = options.feedback?.trim()
    ? feedbackMessage({ role, feedback: options.feedback })
    : undefined;

  let paneId: string;
  {
    const launched = await options.launchWorker({
      runId: options.runId,
      resultPath,
      delivery: 'direct_prompt',
      prompt,
      contractPath: options.contractPath,
      role,
      stage: options.stage,
      attempt: options.attempt,
      userMessage,
    });
    paneId = launched.paneId;
  }

  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const startedAt = Date.now();
  let idleMs = 0;
  let nudgesSent = 0;
  let relaunches = 0;
  let lastWorkerCheckFailed = false;

  while (true) {
    const result = readStageResult({
      resultPath,
      runId: options.runId,
      role,
      attempt: options.attempt,
    });
    if (result) {
      if (isGuardHalt(result)) {
        const settled = await settleGuardResult({
          provisional: result,
          resultPath,
          runId: options.runId,
          role,
          attempt: options.attempt,
          settleMs: options.guardSettleMs,
        });
        return { result: settled, paneId };
      }
      return { result, paneId };
    }

    if (Date.now() - startedAt >= options.hardTimeoutMs) {
      break;
    }

    await sleep(pollIntervalMs);

    let isWorking = true;
    if (options.checkAgentWorking) {
      isWorking = await options.checkAgentWorking(paneId).catch(() => {
        lastWorkerCheckFailed = true;
        return true;
      });
    }
    if (isWorking) {
      idleMs = 0;
      lastWorkerCheckFailed = false;
      continue;
    }

    idleMs += pollIntervalMs;

    // Detect truly dead worker (idle + check works + reports dead)
    if (!lastWorkerCheckFailed && idleMs >= DEAD_CHECK_GRACE_MS && relaunches < MAX_RELAUNCHES) {
      console.warn(
        `⚠️  ${role} process dead (attempt ${options.attempt}/${options.attempt + MAX_RELAUNCHES - relaunches}). Relaunching...`,
      );
      relaunches += 1;
      idleMs = 0;
      // 🔴 A relaunch spawns a NEW pane — adopt its paneId before the next
      // checkAgentWorking/nudgeWorker call, or health checks keep polling
      // the dead pane and every relaunch looks like another crash.
      const relaunched = await options.launchWorker({
        runId: options.runId,
        resultPath,
        delivery: 'direct_prompt',
        prompt: options.feedback?.trim()
          ? `Resume the ${role} stage for ${options.runId}. Check CONTRACT_PIPELINE_RESULT_PATH first — if valid, ONLY call contract_stage_complete with that status. Otherwise continue work.`
          : '',
        contractPath: options.contractPath,
        role,
        stage: options.stage,
        attempt: options.attempt,
        userMessage:
          '🔴 RELAUNCH: Worker crashed. Resume from prior findings and call contract_stage_complete.',
      });
      paneId = relaunched.paneId;
      // Relaunch succeeded — continue polling
      continue;
    }

    if (idleMs >= NUDGE_AFTER_IDLE_MS && nudgesSent < MAX_NUDGES && options.nudgeWorker) {
      nudgesSent += 1;
      idleMs = 0;
      console.warn(
        `⚠️  ${role} idle for ~${Math.round(NUDGE_AFTER_IDLE_MS / 1000)}s — nudging (${nudgesSent}/${MAX_NUDGES}).`,
      );
      await options
        .nudgeWorker({
          paneId,
          message: `You finished a turn without calling contract_stage_complete. If your ${role} stage work is done, call contract_stage_complete NOW with your final status. If work remains, continue it. Do not ask questions — if stuck, complete with status blocked.`,
        })
        .catch(() => {});
      continue;
    }
    if (idleMs >= options.idleTimeoutMs) {
      break;
    }
  }

  // ── Idle timeout fired — check if worker is truly dead ──
  let workerIsDead = false;
  if (options.checkAgentWorking) {
    const checkResult = await options.checkAgentWorking(paneId).catch(() => true);
    workerIsDead = !checkResult && !lastWorkerCheckFailed;
  }

  if (workerIsDead && relaunches < MAX_RELAUNCHES) {
    console.warn(
      `⚠️  ${role} process dead after idle timeout. Final relaunch (${relaunches + 1}/${MAX_RELAUNCHES})...`,
    );
    relaunches += 1;
    idleMs = 0;
    const relaunched = await options.launchWorker({
      runId: options.runId,
      resultPath,
      delivery: 'direct_prompt',
      prompt: `Resume the ${role} stage for ${options.runId}. Check CONTRACT_PIPELINE_RESULT_PATH — if valid, call contract_stage_complete with that status. Otherwise continue.`,
      contractPath: options.contractPath,
      role,
      stage: options.stage,
      attempt: options.attempt,
      generation: options.generation,
      userMessage: '🔴 FINAL RELAUNCH: Worker crashed. Resume and call contract_stage_complete.',
    });
    paneId = relaunched.paneId;
    // Give relaunch 30s to produce a result
    const finalDeadline = Date.now() + 30_000;
    while (Date.now() < finalDeadline) {
      const recovered = readStageResult({
        resultPath,
        runId: options.runId,
        role,
        attempt: options.attempt,
      });
      if (recovered) {
        console.log(`✅ Recovered ${role} result after relaunch: ${recovered.status}`);
        return { result: recovered, paneId };
      }
      await sleep(SLOW_POLL_MS);
    }
  }

  // ── Slow recovery polling — keep trying until hard timeout ──
  console.warn(
    `⚠️  ${role} idle timeout reached. Switching to recovery polling (every ${SLOW_POLL_MS / 1000}s) until hard timeout...`,
  );

  while (Date.now() - startedAt < options.hardTimeoutMs) {
    const recovered = readStageResult({
      resultPath,
      runId: options.runId,
      role,
      attempt: options.attempt,
    });
    if (recovered) {
      console.log(`✅ Recovered ${role} result after idle timeout: ${recovered.status}`);
      return { result: recovered, paneId };
    }
    await sleep(SLOW_POLL_MS);
  }

  // ── Hard timeout — truly terminal ───────────────────────
  const lastChance = readStageResult({
    resultPath,
    runId: options.runId,
    role,
    attempt: options.attempt,
  });
  if (lastChance) {
    return { result: lastChance, paneId };
  }

  const blockedResult: ContractStageResult = {
    runId: options.runId,
    stage: role,
    attempt: options.attempt,
    status: 'blocked',
    summary: `Worker unresponsive for ${Math.round(options.hardTimeoutMs / 60_000)} min — hard timeout reached after ${relaunches} relaunch(es).`,
    findings: ['No valid contract_stage_complete result was produced before hard timeout.'],
    filesTouched: [],
    evidence: [],
    contractHash: '',
    diffHash: '',
    haltedBy: 'hard_timeout',
  };
  writeStageResult({ resultPath, result: blockedResult });
  return { result: blockedResult, paneId };
};
