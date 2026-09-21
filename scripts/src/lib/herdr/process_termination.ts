// scripts/src/lib/herdr/process_termination.ts
//
// 🔴 The termination boundary. Every signal this pipeline sends to a process it
// did not spawn itself passes through here (C-471 AC-1, brief P0).
//
// Why this is its own module: `verifyOwnership` proves ownership at ONE
// instant, but the signal happens later. Reducing the proven evidence back to a
// bare `pid` at that point re-opens the exact race the creation identity exists
// to close:
//
//     verify  PID 123 / creation identity A
//     PID 123 exits, the OS recycles the number
//     a stranger now holds PID 123 / creation identity B
//     killPid(123) signals the stranger
//
// So the VALIDATED IDENTITY crosses this boundary, not a PID, and the live
// creation identity is re-read immediately before the signal. A changed or
// unreadable identity returns a refusal and NO signal is sent.
//
// ── What this can and cannot guarantee ────────────────────────────────────
//
// Linux, macOS and Windows: no process API reachable from Node or Bun accepts a
// creation-identity-bound handle for SIGNALLING. POSIX `kill(2)` takes a PID;
// Windows `taskkill` takes a PID. The identity check is therefore a separate
// observation, and a sub-instruction window remains between that read and the
// syscall — the `kill`/`taskkill` child process must itself be spawned, which
// costs milliseconds. (Linux `pidfd_open` + `pidfd_send_signal` really is
// race-free, but neither Node nor Bun exposes it; reaching it would mean a
// native addon, which is not a proportionate cost for a dev-tooling cleanup.)
//
// What IS guaranteed: this code never KNOWINGLY signals a PID whose live
// creation identity has already changed. The check sits immediately before the
// call that spawns the signaller — inside the primitive, not in a caller that
// then hands over a bare PID — which is as close to the signal as these
// platforms allow.

import { killPid } from '../env/process_info';
import {
  type ProcessInspector,
  recheckProcessIdentity,
  type ValidatedProcessIdentity,
} from './instance_registry.ts';

/** Why a validated process was left unsignalled. */
export type TerminationRefusal = 'identity_unknown' | 'identity_changed' | 'signal_failed';

/** Result of attempting to terminate a validated process. */
export type TerminationResult =
  | { terminated: true }
  | { terminated: false; reason: TerminationRefusal; liveStartTimeMs?: number };

/** Sends the termination signal for `pid`; injectable so tests never shell out. */
export type ProcessSignaller = (pid: number) => Promise<boolean>;

/**
 * Terminate a process ONLY while it still IS the process whose ownership was
 * validated.
 *
 * 🔴 The identity re-read and the signal live in the same function on purpose.
 * A caller that checks the identity and then calls a pid-only primitive leaves a
 * window it cannot close; here the window is the one call below and nothing
 * else. This is the only sanctioned way to signal a process this pipeline did
 * not spawn, and any future escalation (SIGKILL after SIGTERM, a retry) must
 * re-enter through it so the identity is re-proved before EVERY signal rather
 * than once per cleanup.
 */
export const terminateValidatedProcess = async (options: {
  identity: ValidatedProcessIdentity;
  inspector: ProcessInspector;
  /** Signal sender override (tests). The identity check runs either way. */
  signal?: ProcessSignaller;
}): Promise<TerminationResult> => {
  const recheck = await recheckProcessIdentity({
    identity: options.identity,
    inspector: options.inspector,
  });

  if (!recheck.matches) {
    // 🔴 No signal. The caller keeps the ownership record so a later, honest
    // cleanup can still find the process if it is genuinely ours.
    return {
      terminated: false,
      reason: recheck.reason,
      liveStartTimeMs: recheck.liveStartTimeMs,
    };
  }

  const terminated = await (options.signal ?? killPid)(options.identity.pid);
  return terminated ? { terminated: true } : { terminated: false, reason: 'signal_failed' };
};
