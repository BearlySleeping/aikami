// scripts/src/lib/herdr/instance_registry.ts
//
// 🔴 Process ownership that does NOT trust executable names (C-471 AC-1,
// brief P0). Before this module, `killPort` killed anything whose executable
// name contained `node`, `bun`, `vite`, `uwsgi`, or `python` — an unrelated
// developer's Node server satisfied that test perfectly, and the pipeline
// would terminate it. Removing the blind `fuser -k` fallback narrowed the
// blast radius but never established ownership.
//
// This module makes ownership a RECORD, not a guess:
//
//   1. When the pipeline starts a service it writes an `InstanceRecord` —
//      service, scope, run identity, checkout, branch, PID, and the PID's
//      CREATION IDENTITY (absolute start time).
//   2. Before killing a port holder, `ownedInstanceFor` looks for a record
//      whose PID is still the SAME PROCESS (creation identity unchanged) and
//      whose checkout/run identity matches the caller. Only then is the PID
//      killable.
//   3. A record whose PID has been recycled (start time differs) is stale —
//      it is diagnostic evidence, never authority to kill. This is the
//      PID-reuse guard the brief asks for.
//
// An unrelated Node/Python process has no record at all, so it survives every
// stop/restart/force-port operation. That is the acceptance gate.
//
// 🔴 `node:`-only. No `Bun.*`. The records live outside the repo (herdr state
// dir) so no checkout is polluted by another checkout's runtime state.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Ownership scope, mirroring `ServiceScope` in session.ts without importing it. */
export type InstanceScope = 'run' | 'shared' | 'external';

/**
 * A persisted record that proves this machine started a specific process for
 * a specific service, run, and checkout.
 */
export type InstanceRecord = {
  /** Canonical service key (e.g. `client`, `hub`). */
  service: string;
  /** Ownership scope at the time the process was started. */
  scope: InstanceScope;
  /** Contract/run identifier that owns the process (empty for ad-hoc starts). */
  runId?: string;
  /** Absolute checkout the process was started from. */
  checkout?: string;
  /** Branch checked out in that checkout, when known. */
  branch?: string;
  /** The PID we started. */
  pid: number;
  /**
   * Creation identity: the PID's absolute start time in epoch milliseconds,
   * captured when the record was written. A later PID with a different start
   * time is a REUSED PID, not our process.
   */
  pidStartTimeMs: number;
  /** Port the process was expected to bind, when known. */
  port?: number;
  /** ISO timestamp the record was written. */
  startedAt: string;
};

/** Why a candidate could not be verified as an owned instance. */
export type OwnershipRejection =
  | 'no_record'
  | 'record_has_wrong_service'
  | 'record_has_wrong_run'
  | 'record_has_wrong_checkout'
  | 'pid_reused'
  | 'pid_start_time_unknown';

/**
 * A process identity that has been ESTABLISHED as owned during validation.
 *
 * 🔴 This value IS the kill authority. It must be produced by the check that
 * proved ownership and carried forward unchanged.
 *
 * Why it is a value and not just a PID: a PID is not a stable identifier —
 * the OS reuses it. Reducing validated evidence to a bare `pid` and then
 * re-reading its creation identity somewhere else opens a TOCTOU window:
 *
 *     validation proves  PID 123 / creation identity A
 *     PID 123 exits, OS recycles it
 *     a later read sees PID 123 / creation identity B
 *     the record then authorizes B — a process we never started
 *
 * Carrying the validated identity through the probe result and persisting it
 * verbatim makes that sequence unrepresentable: there is no second read to
 * disagree with the first.
 */
export type ValidatedProcessIdentity = {
  /** PID whose ownership was validated. */
  pid: number;
  /** Absolute process start time (epoch ms) observed DURING that validation. */
  pidStartTimeMs: number;
};

/** Result of verifying a live PID against the instance records. */
export type OwnershipVerdict =
  | { owned: true; record: InstanceRecord; identity: ValidatedProcessIdentity }
  | { owned: false; reason: OwnershipRejection; record?: InstanceRecord };

/** Reads a live process's creation identity + cwd; injectable so tests never shell out. */
export type ProcessInspector = {
  /** Absolute start time (epoch ms), or undefined when unknown. */
  startTimeMs: (pid: number) => Promise<number | undefined>;
  /** Working directory, or undefined when unknown. */
  cwd: (pid: number) => Promise<string | undefined>;
};

/** The identity a caller expects a record to carry before authorizing a kill. */
export type ExpectedOwnership = {
  service?: string;
  runId?: string;
  checkout?: string;
};

/** Tolerance (ms) when comparing a recorded start time to the live one. */
const START_TIME_TOLERANCE_MS = 2_000;

/**
 * Outcome of re-reading a live PID's creation identity and comparing it with a
 * validated one. Distinguishes "the process is gone / unreadable" from "the PID
 * now belongs to a different process", because both must block a signal but
 * only the second means the PID was recycled.
 */
export type IdentityRecheck =
  | { matches: true; liveStartTimeMs: number }
  | { matches: false; reason: 'identity_unknown' | 'identity_changed'; liveStartTimeMs?: number };

/**
 * Re-read a live PID's creation identity and compare it with a validated one.
 *
 * 🔴 This is the single comparison behind every "is this still our process?"
 * decision, so the termination boundary and the pre-action helpers can never
 * disagree about what counts as the same process.
 *
 * 🔴 Timing matters as much as the comparison: `verifyOwnership` proves
 * ownership at one instant, and a PID can be recycled before the action it
 * authorizes. Call it as close to that action as the platform allows — for a
 * signal, that means inside the primitive that sends it (see
 * process_termination.ts), not in the caller that then hands over a bare PID.
 */
export const recheckProcessIdentity = async (options: {
  identity: ValidatedProcessIdentity;
  inspector: ProcessInspector;
}): Promise<IdentityRecheck> => {
  const liveStartTimeMs = await options.inspector.startTimeMs(options.identity.pid);
  if (liveStartTimeMs === undefined) {
    return { matches: false, reason: 'identity_unknown' };
  }
  if (Math.abs(liveStartTimeMs - options.identity.pidStartTimeMs) > START_TIME_TOLERANCE_MS) {
    return { matches: false, reason: 'identity_changed', liveStartTimeMs };
  }
  return { matches: true, liveStartTimeMs };
};

/** Default directory for instance records. */
export const instanceRegistryDir = (): string => join(homedir(), '.herdr', 'aikami', 'instances');

/** Filesystem-safe key for a service+pid record. */
const recordFileName = (record: Pick<InstanceRecord, 'service' | 'pid'>): string =>
  `${record.service.replace(/[^A-Za-z0-9._-]/g, '-')}-${record.pid}.json`;

/** Absolute path of a record file. */
const recordPath = (options: {
  dir: string;
  record: Pick<InstanceRecord, 'service' | 'pid'>;
}): string => join(options.dir, recordFileName(options.record));

/**
 * Persist an ownership record for a just-started process. Best-effort: a
 * registry write failure must never break service startup — it only means the
 * process will not be auto-killable, which is the safe direction.
 */
export const recordInstance = (options: { record: InstanceRecord; dir?: string }): void => {
  const dir = options.dir ?? instanceRegistryDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      recordPath({ dir, record: options.record }),
      JSON.stringify(options.record, null, 2),
    );
  } catch {
    // Best-effort. Losing the record only makes the process non-killable.
  }
};

/** Remove a record (called when a process is deliberately stopped). */
export const clearInstance = (options: { service: string; pid: number; dir?: string }): void => {
  const dir = options.dir ?? instanceRegistryDir();
  try {
    rmSync(recordPath({ dir, record: { service: options.service, pid: options.pid } }), {
      force: true,
    });
  } catch {
    // Best-effort.
  }
};

/** Read every record in the registry. Malformed files are skipped. */
export const readInstanceRecords = (options: { dir?: string } = {}): InstanceRecord[] => {
  const dir = options.dir ?? instanceRegistryDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const records: InstanceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as unknown;
      if (isInstanceRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // Skip malformed records — a corrupt file is not a killable process.
    }
  }
  return records;
};

/** Strict shape check for a parsed record. */
const isInstanceRecord = (value: unknown): value is InstanceRecord => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.service === 'string' &&
    (record.scope === 'run' || record.scope === 'shared' || record.scope === 'external') &&
    typeof record.pid === 'number' &&
    Number.isInteger(record.pid) &&
    typeof record.pidStartTimeMs === 'number' &&
    Number.isFinite(record.pidStartTimeMs) &&
    typeof record.startedAt === 'string'
  );
};

/**
 * Verify that `pid` is the exact process a record describes — same service,
 * run, checkout, AND same creation identity (so a reused PID is rejected).
 *
 * 🔴 `expected` narrows verification: when the caller knows which service/run
 * it is freeing, a record for a different one must not authorize the kill.
 *
 * 🔴 EVERY record for the PID is evaluated, not just one. The registry filename
 * is `<service>-<pid>.json`, so several records can legitimately share a PID
 * (a `client` that exited, then a `hub` that the OS gave the same number), and
 * `readInstanceRecords` returns filesystem order, which is not stable. Deciding
 * on a single candidate let a stale record shadow a live owned one: the caller
 * saw `pid_reused` and left a genuinely owned server holding the port, which is
 * the "cannot delete worktree" failure teardown exists to prevent.
 */
export const verifyOwnership = async (options: {
  pid: number;
  expected?: ExpectedOwnership;
  records: readonly InstanceRecord[];
  inspector: ProcessInspector;
}): Promise<OwnershipVerdict> => {
  const candidates = options.records.filter((candidate) => candidate.pid === options.pid);
  if (candidates.length === 0) {
    return { owned: false, reason: 'no_record' };
  }

  // Try the records that match the caller's expectation FIRST, so a rejection
  // names the mismatch the caller cares about, and so a matching record is
  // never shadowed by an unrelated one.
  const preferred = candidates.filter((candidate) => matchesExpected(candidate, options.expected));
  const ordered = [
    ...preferred,
    ...candidates.filter((candidate) => !preferred.includes(candidate)),
  ];

  let firstRejection: { reason: OwnershipRejection; record: InstanceRecord } | undefined;
  for (const record of ordered) {
    const verdict = await checkCandidate({
      record,
      expected: options.expected,
      inspector: options.inspector,
    });
    if (verdict.owned) {
      // 🔴 `liveStartTimeMs` was read HERE, in the same observation that
      // established ownership. Return it as the validated identity so callers
      // carry it instead of re-reading (and possibly observing a recycled PID).
      return {
        owned: true,
        record,
        identity: { pid: record.pid, pidStartTimeMs: verdict.liveStartTimeMs },
      };
    }
    firstRejection ??= { reason: verdict.reason, record };
  }

  // Unreachable in practice (the loop always assigns), but the type needs it.
  if (!firstRejection) {
    return { owned: false, reason: 'no_record' };
  }
  return { owned: false, reason: firstRejection.reason, record: firstRejection.record };
};

/**
 * Check ONE record against the caller's expectation and the live process.
 *
 * Split out so `verifyOwnership` can run it per candidate; the checks are
 * unchanged, and the live creation identity is still read at most once per
 * candidate.
 */
const checkCandidate = async (options: {
  record: InstanceRecord;
  expected: ExpectedOwnership | undefined;
  inspector: ProcessInspector;
}): Promise<
  { owned: true; liveStartTimeMs: number } | { owned: false; reason: OwnershipRejection }
> => {
  const { record, expected } = options;
  if (expected?.service !== undefined && record.service !== expected.service) {
    return { owned: false, reason: 'record_has_wrong_service' };
  }
  if (expected?.runId !== undefined && record.runId !== expected.runId) {
    return { owned: false, reason: 'record_has_wrong_run' };
  }
  if (expected?.checkout !== undefined && record.checkout !== expected.checkout) {
    return { owned: false, reason: 'record_has_wrong_checkout' };
  }

  // 🔴 PID-reuse guard: the live process must have the SAME creation identity.
  const liveStartTimeMs = await options.inspector.startTimeMs(record.pid);
  if (liveStartTimeMs === undefined) {
    return { owned: false, reason: 'pid_start_time_unknown' };
  }
  if (Math.abs(liveStartTimeMs - record.pidStartTimeMs) > START_TIME_TOLERANCE_MS) {
    return { owned: false, reason: 'pid_reused' };
  }

  return { owned: true, liveStartTimeMs };
};

/** Whether a record carries the identity a caller expects (before live checks). */
const matchesExpected = (
  record: InstanceRecord,
  expected: ExpectedOwnership | undefined,
): boolean => {
  if (!expected) {
    return true;
  }
  if (expected.service !== undefined && record.service !== expected.service) {
    return false;
  }
  if (expected.runId !== undefined && record.runId !== expected.runId) {
    return false;
  }
  if (expected.checkout !== undefined && record.checkout !== expected.checkout) {
    return false;
  }
  return true;
};

/**
 * Find the owned instance (if any) currently holding `port`, verifying each
 * record against the live process. Returns the first verified record together
 * with the process identity proven by that verification, or undefined when the
 * port is held by something we do not own.
 *
 * The port→PID mapping is supplied by the caller (`pidsOnPort`) so this module
 * stays free of the platform process plumbing.
 */
export const ownedInstanceOnPort = async (options: {
  port: number;
  pids: readonly number[];
  expected?: ExpectedOwnership;
  records: readonly InstanceRecord[];
  inspector: ProcessInspector;
}): Promise<
  { pid: number; record: InstanceRecord; identity: ValidatedProcessIdentity } | undefined
> => {
  for (const pid of options.pids) {
    const verdict = await verifyOwnership({
      pid,
      expected: options.expected,
      records: options.records,
      inspector: options.inspector,
    });
    if (verdict.owned) {
      return { pid, record: verdict.record, identity: verdict.identity };
    }
  }
  return undefined;
};
