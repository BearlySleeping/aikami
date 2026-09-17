// scripts/src/lib/herdr/port_owner.ts
//
// Port-freeing policy with PROVEN ownership (C-471 AC-1, brief P0). Extracted
// from `session.ts` so the size-ratcheted session module does not grow.
//
// 🔴 The old policy killed anything whose executable name contained `node`,
// `bun`, `vite`, `uwsgi`, or `python` — an unrelated developer's process
// satisfied that test. Ownership is now established by a persisted
// `InstanceRecord` with PID creation identity (see instance_registry.ts). A
// process with no matching record is never killed.

import type { DevService } from '@aikami/constants';
import { pidsOnPort, processCwd, processStartTimeMs } from '../env/process_info';
import { reportInfraIssue } from '../ops/infra_report.ts';
import {
  clearInstance,
  type OwnershipRejection,
  type ProcessInspector,
  readInstanceRecords,
  verifyOwnership,
} from './instance_registry.ts';
import {
  type ProcessSignaller,
  type TerminationRefusal,
  terminateValidatedProcess,
} from './process_termination.ts';

/**
 * Read a live process's creation identity + cwd, backed by env/process_info.
 * Injectable so tests never shell out (see {@link killPort}).
 */
const defaultInspector: ProcessInspector = {
  startTimeMs: (pid) => processStartTimeMs(pid),
  cwd: (pid) => processCwd(pid),
};

/** Options that narrow which instance a port-free operation may kill. */
export type KillPortOptions = {
  /** Expected service key; a record for another service is not killable. */
  service?: DevService;
  /** Expected run id; a record for another run is not killable. */
  runId?: string;
  /** Expected checkout; a record for another checkout is not killable. */
  checkout?: string;
  /** Registry location override (used by tests). */
  registryDir?: string;
  /** Process inspector override (used by tests). */
  inspector?: ProcessInspector;
  /** Port-listener lookup override (used by tests). */
  listPids?: (port: number) => Promise<number[]>;
  /**
   * Signal sender override (used by tests). The identity recheck still runs —
   * the seam is the syscall, not the safety check.
   */
  signal?: ProcessSignaller;
};

/**
 * Kill any process occupying a port so the next bind succeeds deterministically.
 *
 * 🔴 Identity is PROVEN before killing. A port holder is terminated only when
 * it matches a persisted ownership record — same service/run/checkout and the
 * same PID creation identity (the PID-reuse guard). An unrelated process, a
 * foreign Node/Python server, or a record whose PID has been recycled each get
 * a warning and are left alone. Platform differences (lsof/ps/kill vs
 * netstat/tasklist/taskkill) live in env/process_info.ts — this is the policy.
 */
export const killPort = async (port: number, options: KillPortOptions = {}): Promise<void> => {
  const pids = await (options.listPids ?? pidsOnPort)(port);

  if (pids.length === 0) {
    // No lookup tool, or genuinely nothing listening. Do NOT fall back to
    // fuser -k (killPortUnsafe) — it kills without an identity check and
    // could terminate an unrelated process. (C-471 AC-1: unknown PID lookup
    // never falls back to blind killing.)
    return;
  }

  const inspector = options.inspector ?? defaultInspector;
  const records = readInstanceRecords({ dir: options.registryDir });
  const expected = {
    service: options.service,
    runId: options.runId,
    checkout: options.checkout,
  };

  for (const pid of pids) {
    const verdict = await verifyOwnership({ pid, expected, records, inspector });

    if (!verdict.owned) {
      const reason = describeRejection(verdict.reason);
      console.warn(`Port ${port} is busy with a process we do not own (PID ${pid}) — ${reason}`);
      reportInfraIssue({
        component: 'killPort',
        operation: `free port ${port}`,
        error: new Error(`port held by unowned process (pid ${pid}): ${verdict.reason}`),
        context: {
          port,
          holderPid: pid,
          rejection: verdict.reason,
          holderService: verdict.record?.service,
        },
      });
      continue;
    }

    // 🔴 The signal is sent by `terminateValidatedProcess`, which re-reads the
    // live creation identity immediately before signalling and refuses when it
    // has changed. There is deliberately NO identity check here: a check at this
    // level would still hand a bare PID to the primitive below and leave the
    // window it cannot see. The validated identity — not `pid` — is what crosses
    // the termination boundary.
    const outcome = await terminateValidatedProcess({
      identity: verdict.identity,
      inspector,
      signal: options.signal,
    });

    if (outcome.terminated) {
      clearInstance({ service: verdict.record.service, pid, dir: options.registryDir });
      continue;
    }

    // 🔴 Every refusal preserves the ownership record. A record cleared on a
    // refused signal would report a cleanup that never happened and lose the
    // only evidence a later run has for finding the process.
    const reason = describeRefusal(outcome.reason);
    console.warn(
      `Port ${port} — owned PID ${pid} was not terminated: ${reason}. Leaving its ownership record in place.`,
    );
    reportInfraIssue({
      component: 'killPort',
      operation: `terminate owned PID ${pid} on port ${port}`,
      error: new Error(`validated termination refused (${outcome.reason}): ${reason}`),
      context: {
        port,
        holderPid: pid,
        holderService: verdict.record.service,
        refusal: outcome.reason,
        liveStartTimeMs: outcome.liveStartTimeMs,
      },
    });
  }
};

/** Human-readable explanation for a refused validated termination. */
const describeRefusal = (reason: TerminationRefusal): string => {
  switch (reason) {
    case 'identity_unknown':
      return 'its creation identity could no longer be read';
    case 'identity_changed':
      return 'the PID now belongs to a different process (recycled) — refusing to signal it';
    default:
      return 'the termination command failed or the target process remained alive';
  }
};

/** Human-readable explanation for a failed ownership check. */
const describeRejection = (reason: OwnershipRejection): string => {
  switch (reason) {
    case 'no_record':
      return 'no ownership record exists for it';
    case 'record_has_wrong_service':
      return 'the record is for a different service';
    case 'record_has_wrong_run':
      return 'the record is for a different run';
    case 'record_has_wrong_checkout':
      return 'the record is for a different checkout';
    case 'pid_reused':
      return 'the PID was reused by an unrelated process';
    case 'pid_start_time_unknown':
      return 'its creation identity could not be verified';
    default:
      return 'ownership could not be established';
  }
};
