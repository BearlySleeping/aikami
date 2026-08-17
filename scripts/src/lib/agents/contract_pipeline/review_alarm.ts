// scripts/src/lib/agents/contract_pipeline/review_alarm.ts
//
// Decides WHEN the review chime sounds.
//
// Previously the alarm fired ~800ms after the review pane was spawned, which
// is the moment pi starts booting — minutes before the captain has read the
// manifest, checked the branch and written its report. The chime therefore
// trained the user to walk over to a pane that had nothing to show yet.
//
// It now fires when the captain finishes its FIRST response, i.e. the moment
// the pane actually wants a human. Detection is delegated to the pure state
// machine in review_pane.ts; this module owns only the polling loop, the
// timeouts and the fallback.
import { isHerdrActive } from '../../herdr/session.ts';
import { playAlarm } from './alarm.ts';
import {
  advanceFirstResponse,
  type FirstResponseState,
  initialFirstResponseState,
} from './review_pane.ts';

/** How often `agent_status` is sampled while waiting for the first response. */
export const POLL_MS: number = Number(process.env.CONTRACT_REVIEW_POLL_MS) || 1_500;

/**
 * Consecutive settled samples required. pi reports `idle` between LLM turns,
 * so 4 × 1.5s ≈ 6s of continuous quiet separates "finished" from "thinking".
 */
export const SETTLE_SAMPLES: number = Number(process.env.CONTRACT_REVIEW_SETTLE_SAMPLES) || 4;

/**
 * Give up waiting after this long and chime anyway — a captain that is still
 * working after 20 minutes has almost certainly hit something the user should
 * look at, and a missed alarm is worse than a late one.
 */
export const FIRST_RESPONSE_TIMEOUT_MS: number =
  Number(process.env.CONTRACT_REVIEW_ALARM_TIMEOUT_MS) || 20 * 60_000;

export type FirstResponseOutcome = 'responded' | 'timeout' | 'pane_gone' | 'cancelled';

/**
 * 🔴 `unref` matters: this loop runs detached while the orchestrator does its
 * own work. A ref'd timer chain would hold the Node event loop open for the
 * full 20-minute timeout, so a pipeline that finished in 30 seconds would sit
 * there refusing to exit.
 */
const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/**
 * Poll `getStatus` until the review captain completes its first response.
 *
 * Never throws — a probe failure is folded in as an unknown status rather
 * than propagated, because this runs detached from the orchestrator's main
 * path and must not be able to fail a run.
 */
export const waitForFirstResponse = async (options: {
  getStatus: () => Promise<string | undefined>;
  isPaneAlive: () => Promise<boolean>;
  timeoutMs?: number;
  pollMs?: number;
  settleSamples?: number;
  /** Returns true once the caller no longer needs the answer. */
  isCancelled?: () => boolean;
  /** Injected for tests; defaults to real sleeping. */
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<FirstResponseOutcome> => {
  const timeoutMs = options.timeoutMs ?? FIRST_RESPONSE_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const settleSamples = options.settleSamples ?? SETTLE_SAMPLES;
  const nap = options.sleepFn ?? sleep;
  const deadline = Date.now() + timeoutMs;

  let state: FirstResponseState = initialFirstResponseState();
  while (Date.now() < deadline) {
    if (options.isCancelled?.()) {
      return 'cancelled';
    }
    if (!(await options.isPaneAlive().catch(() => true))) {
      return 'pane_gone';
    }
    const status = await options.getStatus().catch(() => undefined);
    state = advanceFirstResponse(state, status, settleSamples);
    if (state.phase === 'responded') {
      return 'responded';
    }
    await nap(pollMs);
  }
  return 'timeout';
};

/**
 * Fire-and-forget: chime once the review captain has answered.
 *
 * Detached on purpose — the orchestrator immediately blocks in
 * `waitForReviewDecision`, so this cannot be awaited without deadlocking the
 * very wait it is timing. The promise is fully self-contained: it swallows
 * every error and only ever calls `playAlarm`, which is itself best-effort.
 *
 * No chime when the pane disappears before responding (the orchestrator's own
 * abandoned-review path handles that, with the error cue), and none when
 * cancelled — a decision that already landed needs no callback to the human.
 *
 * Only a FALLBACK when herdr can't notify on its own: while its server
 * daemon is running, herdr already surfaces an idle pane wanting attention
 * (bell/indicator), so playing our own chime on top would just double up.
 * Skip it only when herdr isn't reachable at all (not installed, daemon
 * down) — then this is the only cue the user gets.
 *
 * @returns a `cancel` that stops the polling. Call it once the decision is in:
 *   otherwise the loop keeps shelling out to `herdr` every poll for the rest
 *   of the timeout, long after anyone cares about the answer.
 */
export const chimeOnFirstResponse = (options: {
  getStatus: () => Promise<string | undefined>;
  isPaneAlive: () => Promise<boolean>;
  onOutcome?: (outcome: FirstResponseOutcome) => void;
  /** Injected for tests; defaults to checking the real herdr daemon. */
  isHerdrActiveFn?: () => Promise<boolean>;
  /** Injected for tests; defaults to the real chime. */
  playAlarmFn?: () => void;
  /** Pass-throughs to waitForFirstResponse; injected for tests. */
  timeoutMs?: number;
  pollMs?: number;
  settleSamples?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): { cancel: () => void } => {
  let cancelled = false;
  const checkHerdrActive = options.isHerdrActiveFn ?? isHerdrActive;
  const chime = options.playAlarmFn ?? playAlarm;
  void waitForFirstResponse({ ...options, isCancelled: () => cancelled })
    .then(async (outcome) => {
      if (outcome === 'responded' || outcome === 'timeout') {
        const herdrActive = await checkHerdrActive().catch(() => false);
        if (!herdrActive) {
          chime();
        }
      }
      options.onOutcome?.(outcome);
    })
    .catch(() => {
      // Best-effort: a broken probe must never surface as an unhandled
      // rejection that takes the pipeline down.
    });
  return {
    cancel: () => {
      cancelled = true;
    },
  };
};
