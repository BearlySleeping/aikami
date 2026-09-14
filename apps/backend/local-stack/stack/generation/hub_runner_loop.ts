// apps/backend/local-stack/stack/generation/hub_runner_loop.ts
//
// C-522 — the runner's poll loop: claim one dispatch, execute it locally,
// report under the fence, and learn about cancellation from the Hub's replies.
//
// Two properties matter more than throughput here:
//
//   1. **Reconnect is free.** A lost response, a closed Hub tab or a restarted
//      process re-claims the *same* dispatch: the Hub pins one job to one
//      device and rejects stale attempts, so there is nothing for this loop to
//      reconcile by hand and no way to submit the same request twice.
//   2. **Cancellation is truthful.** The Hub can only answer, never push, so a
//      cancel arrives on the heartbeat's response. This loop stops waiting and
//      reports `cancelled` with `confirmed: false` unless the engine actually
//      reported a provider-side stop — a Hub that claimed success would be
//      lying about a GPU that is still running.
//
// Contract: C-522 Hub and client access to the generation runner

import type { GenerationDispatch, GenerationDispatchFence } from '@aikami/types';
import type { HubDispatchExecutor } from './hub_dispatch_executor.ts';
import { type HubRunnerClient, isTerminalRefusal } from './hub_runner_client.ts';

/** A structured event, safe for routine logs (no credential, no prompt text). */
export type HubRunnerLoopEvent =
  | { kind: 'idle'; reason: string }
  | { kind: 'claimed'; dispatchId: string; jobId: string; attempt: number }
  | { kind: 'heartbeat'; dispatchId: string; status: string }
  | { kind: 'cancellation_requested'; dispatchId: string }
  | { kind: 'finished'; dispatchId: string; status: string; candidateCount: number }
  | { kind: 'refused'; dispatchId: string; code: string; message: string }
  | { kind: 'stopped'; code: string; message: string };

/** Options for {@link runHubRunnerLoop}. */
export type HubRunnerLoopOptions = {
  client: HubRunnerClient;
  deviceId: string;
  /** The physical group this process is free to use (`gpu:0`). */
  resourceGroup: string;
  modalities: readonly string[];
  execute: HubDispatchExecutor;
  /** Injected clock. */
  now?: () => Date;
  leaseTtlMs?: number;
  /** Delay between idle polls. */
  pollIntervalMs?: number;
  /** Status heartbeat cadence while a job runs — this is how cancel arrives. */
  heartbeatMs?: number;
  /** Stop after this many consecutive idle polls. `undefined` polls forever. */
  idlePollsBeforeExit?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: HubRunnerLoopEvent) => void;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run one dispatch to completion, heartbeating so cancellation can arrive.
 *
 * Returns once the outcome has been reported (or a terminal refusal was seen).
 */
const runClaimed = async (
  options: Required<Pick<HubRunnerLoopOptions, 'now' | 'leaseTtlMs' | 'heartbeatMs' | 'sleep'>> & {
    client: HubRunnerClient;
    deviceId: string;
    execute: HubDispatchExecutor;
    emit: (event: HubRunnerLoopEvent) => void;
    dispatch: GenerationDispatch;
    fence: GenerationDispatchFence;
  },
): Promise<void> => {
  const { dispatch, fence } = options;
  const tick = (): ReturnType<HubRunnerClient['reportStatus']> =>
    options.client.reportStatus({
      deviceId: options.deviceId,
      dispatchId: dispatch.dispatchId,
      attempt: fence.attempt,
      leaseId: fence.lease.leaseId,
      status: 'running',
      candidateCount: 0,
      now: options.now(),
    });

  // `preparing` then `running` — the two states the Hub UI renders differently.
  const started = await options.client.reportStatus({
    deviceId: options.deviceId,
    dispatchId: dispatch.dispatchId,
    attempt: fence.attempt,
    leaseId: fence.lease.leaseId,
    status: 'preparing',
    candidateCount: 0,
    now: options.now(),
  });
  if (!started.ok) {
    options.emit({
      kind: 'refused',
      dispatchId: dispatch.dispatchId,
      code: started.code,
      message: started.message,
    });
    return;
  }

  let cancelled = false;
  const heartbeat = setInterval(() => {
    void tick().then((result) => {
      if (result.ok && result.value.pendingCancellationDispatchIds.includes(dispatch.dispatchId)) {
        // The Hub answered a runner-initiated request with a cancel ask. Stop
        // waiting — the running compute may or may not stop, which is exactly
        // why the report below says `confirmed: false` until the engine says
        // otherwise.
        cancelled = true;
        options.emit({ kind: 'cancellation_requested', dispatchId: dispatch.dispatchId });
      }
    });
  }, options.heartbeatMs);

  let outcome: Awaited<ReturnType<HubDispatchExecutor>>;
  try {
    outcome = await options.execute(dispatch);
  } finally {
    clearInterval(heartbeat);
  }

  const status = cancelled && outcome.status !== 'succeeded' ? 'cancelled' : outcome.status;
  const reported = await options.client.reportStatus({
    deviceId: options.deviceId,
    dispatchId: dispatch.dispatchId,
    attempt: fence.attempt,
    leaseId: fence.lease.leaseId,
    status,
    candidateCount: outcome.candidateCount,
    ...(outcome.candidateId === undefined ? {} : { candidateId: outcome.candidateId }),
    ...(outcome.preparedHash === undefined ? {} : { preparedHash: outcome.preparedHash }),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    ...(status === 'cancelled'
      ? {
          cancellation: {
            requested: true,
            requestedAt: options.now().toISOString(),
            confirmed: false,
            reason: 'cancellation was requested; this engine reports no provider-side confirmation',
          },
        }
      : {}),
    now: options.now(),
  });
  if (!reported.ok) {
    options.emit({
      kind: 'refused',
      dispatchId: dispatch.dispatchId,
      code: reported.code,
      message: reported.message,
    });
    return;
  }

  if (outcome.preparedHash !== undefined && outcome.candidateId !== undefined) {
    // The completion seam: a private candidate and nothing else. Acceptance and
    // publication stay the creator's separate, explicit decisions.
    const candidate = await options.client.reportCandidate({
      deviceId: options.deviceId,
      dispatch,
      fence,
      candidateId: outcome.candidateId,
      preparedHash: outcome.preparedHash,
      seed: dispatch.spec.seed,
      provenanceState: 'partial',
      now: options.now(),
    });
    if (!candidate.ok) {
      options.emit({
        kind: 'refused',
        dispatchId: dispatch.dispatchId,
        code: candidate.code,
        message: candidate.message,
      });
    }
  }

  options.emit({
    kind: 'finished',
    dispatchId: dispatch.dispatchId,
    status,
    candidateCount: outcome.candidateCount,
  });
};

/**
 * The long-lived runner loop.
 *
 * A terminal refusal (`device_revoked`, `unauthorized`) ends the loop rather
 * than retrying: the creator has withdrawn this credential, and spinning would
 * be the "queued forever" failure mode the contract explicitly forbids.
 */
export const runHubRunnerLoop = async (options: HubRunnerLoopOptions): Promise<void> => {
  const now = options.now ?? (() => new Date());
  const leaseTtlMs = options.leaseTtlMs ?? 300_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(leaseTtlMs / 4));
  const sleep = options.sleep ?? defaultSleep;
  const emit = (event: HubRunnerLoopEvent): void => options.onEvent?.(event);

  let idlePolls = 0;
  for (;;) {
    const claimed = await options.client.claim({
      deviceId: options.deviceId,
      resourceGroup: options.resourceGroup,
      leaseTtlMs,
      modalities: options.modalities,
      now: now(),
    });
    if (!claimed.ok) {
      emit({ kind: 'stopped', code: claimed.code, message: claimed.message });
      if (isTerminalRefusal(claimed)) {
        return;
      }
      await sleep(pollIntervalMs);
      continue;
    }
    if (!claimed.value.claimed) {
      idlePolls += 1;
      emit({ kind: 'idle', reason: claimed.value.reason });
      if (options.idlePollsBeforeExit !== undefined && idlePolls >= options.idlePollsBeforeExit) {
        return;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    idlePolls = 0;
    const { dispatch, fence } = claimed.value;
    emit({
      kind: 'claimed',
      dispatchId: dispatch.dispatchId,
      jobId: dispatch.jobId,
      attempt: fence.attempt,
    });
    await runClaimed({
      client: options.client,
      deviceId: options.deviceId,
      execute: options.execute,
      now,
      leaseTtlMs,
      heartbeatMs,
      sleep,
      emit,
      dispatch,
      fence,
    });
  }
};
