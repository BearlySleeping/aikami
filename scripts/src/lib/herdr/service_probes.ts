// scripts/src/lib/herdr/service_probes.ts
//
// Instance-bound readiness probes for run-owned application services
// (C-471 AC-2, brief P1). Extracted from `session.ts` so the size-ratcheted
// session module does not grow, and so the probe policy is testable without a
// live Herdr.
//
// Two probes exist, by capability:
//
//   • `makeAppIdentityProbe` — for services that serve the dev identity
//     endpoint (`/.aikami/identity`, see ops/dev_identity_plugin.ts). The
//     client/hub dev servers use this: a responsive server from ANOTHER
//     checkout reports a different `checkout` and is rejected.
//
//   • `makeListenerOwnershipProbe` — for services that cannot serve an
//     endpoint (e.g. `hub-worker` under wrangler). Verifies the listening
//     PID against a persisted ownership record with PID creation identity.
//
// Both are factories taking their dependencies as closures, mirroring
// engine_probe.ts, so this module imports no runtime bindings from session.ts
// (avoiding a cycle).

import { isAbsolute, relative } from 'node:path';
import type { DevService } from '@aikami/constants';
import {
  type InstanceRecord,
  type ProcessInspector,
  readInstanceRecords,
  recordInstance,
  type ValidatedProcessIdentity,
  verifyOwnership,
} from './instance_registry.ts';
import type { ProbeResult, ServiceDef, ServiceIdentity } from './session.ts';

/** Resolves a service's ready port for the ambient mode (contract-offset aware). */
export type ProbePortResolver = (serviceKey: DevService) => number | undefined;

/** Lists PIDs listening on a port (injected from env/process_info). */
export type PidLister = (port: number) => Promise<number[]>;

/** True when a value is a plain (non-array) object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The path the dev identity endpoint answers on. Kept in sync with the plugin. */
export const DEV_IDENTITY_PATH = '/.aikami/identity';

/** True when a service process cwd is the checkout or one of its subdirectories. */
const isWithinCheckout = (cwd: string, checkout: string): boolean => {
  const path = relative(checkout, cwd);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/**
 * Read an application's dev identity endpoint. Returns undefined when absent
 * or malformed — which must fail the probe, never pass it.
 */
export const fetchDevIdentity = async (
  port: number,
): Promise<Partial<ServiceIdentity> | undefined> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${DEV_IDENTITY_PATH}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) {
      return undefined;
    }
    return {
      service: typeof data.service === 'string' ? (data.service as DevService) : undefined,
      checkout: typeof data.checkout === 'string' ? data.checkout : undefined,
      runId: typeof data.runId === 'string' ? data.runId : undefined,
      pid:
        typeof data.pid === 'number' && Number.isInteger(data.pid) && data.pid > 0
          ? data.pid
          : undefined,
    };
  } catch {
    return undefined;
  }
};

/**
 * Build a recorder that persists an ownership record for a service that just
 * became ready.
 *
 * 🔴 It persists the process identity its probe ESTABLISHED, verbatim — it
 * never re-reads `startTimeMs(pid)`. A second read is a second observation,
 * and if the PID were recycled in between, the record would authorize a
 * process we never started. See `ValidatedProcessIdentity`.
 *
 * A probe that established no PID identity leaves the service non-killable.
 */
export const makeInstanceRecorder =
  (options: {
    scopeOf: (service: DevService) => InstanceRecord['scope'];
    currentRunId: () => string | undefined;
    checkout: () => string;
    registryDir?: string;
  }) =>
  async (entry: {
    service: DevService;
    port: number;
    validatedProcess?: ValidatedProcessIdentity;
  }): Promise<void> => {
    if (entry.validatedProcess === undefined) {
      return;
    }
    const record: InstanceRecord = {
      service: entry.service,
      scope: options.scopeOf(entry.service),
      runId: options.currentRunId(),
      checkout: options.checkout(),
      pid: entry.validatedProcess.pid,
      pidStartTimeMs: entry.validatedProcess.pidStartTimeMs,
      port: entry.port,
      startedAt: new Date().toISOString(),
    };
    recordInstance({ record, dir: options.registryDir });
  };

/**
 * Build an instance-bound probe for a run-owned service that serves the dev
 * identity endpoint. A responsive server from another checkout reports a
 * different `checkout` and is rejected by the readiness verifier.
 *
 * 🔴 The endpoint reports its own PID but not its creation identity, so the
 * probe ESTABLISHES that identity here, as part of readiness verification, and
 * returns it as ownership evidence. The recorder persists it verbatim; it must
 * never be re-derived from a later lookup of the same PID.
 *
 * 🔴 That PID is CALLER-CONTROLLED evidence — it comes from an HTTP response.
 * Before it can become kill authority it must be bound to the server that
 * answered: only a process actually LISTENING on the probed port may be
 * recorded, or a server could nominate an unrelated live PID and have us
 * terminate it later.
 *
 * Every failure below (no PID, not a listener, no creation identity) yields the
 * same fail-closed result: ready, but with NO kill authority.
 */
export const makeAppIdentityProbe =
  (options: { resolvePort: ProbePortResolver; listPids: PidLister; inspector: ProcessInspector }) =>
  (serviceKey: DevService): NonNullable<ServiceDef['probe']> =>
  async (expectedIdentity: ServiceIdentity): Promise<ProbeResult> => {
    const port = options.resolvePort(serviceKey);
    if (port === undefined) {
      return { ready: false, reason: `${serviceKey} has no ready port defined` };
    }
    const observedIdentity = await fetchDevIdentity(port);
    if (!observedIdentity) {
      return {
        ready: false,
        reason: `${serviceKey} did not report an instance identity on :${port}`,
      };
    }
    for (const field of ['service', 'checkout', 'runId'] as const) {
      const expected = expectedIdentity[field];
      if (expected !== undefined && observedIdentity[field] !== expected) {
        return {
          ready: false,
          observedIdentity,
          reason: `${serviceKey} reported a mismatched ${field}`,
        };
      }
    }

    const pid = observedIdentity.pid;
    if (pid === undefined) {
      return { ready: true, observedIdentity };
    }
    const listeners = await options.listPids(port).catch((): number[] => []);
    if (!listeners.includes(pid)) {
      return { ready: true, observedIdentity };
    }
    const pidStartTimeMs = await options.inspector.startTimeMs(pid);
    if (pidStartTimeMs === undefined) {
      return { ready: true, observedIdentity };
    }
    return {
      ready: true,
      observedIdentity,
      validatedProcess: { pid, pidStartTimeMs },
    };
  };

/**
 * Build an instance-bound probe for a run-owned service that CANNOT serve an
 * identity endpoint. Verifies the listening PID against the persisted
 * ownership record — same service, run, and checkout, and same PID creation
 * identity. A server we did not start has no matching record and is rejected.
 *
 * 🔴 The creation identity it returns is the one `verifyOwnership` proved (or
 * the one established during trusted bootstrap), never a fresh read: the
 * identity that authorized readiness is the identity that gets persisted.
 */
export const makeListenerOwnershipProbe =
  (options: {
    resolvePort: ProbePortResolver;
    listPids: PidLister;
    inspector: ProcessInspector;
    registryDir?: string;
  }) =>
  (serviceKey: DevService): NonNullable<ServiceDef['probe']> =>
  async (expectedIdentity: ServiceIdentity, context): Promise<ProbeResult> => {
    const port = options.resolvePort(serviceKey);
    if (port === undefined) {
      return { ready: false, reason: `${serviceKey} has no ready port defined` };
    }
    const pids = await options.listPids(port);
    if (pids.length === 0) {
      return { ready: false, reason: `${serviceKey} is not listening on :${port}` };
    }
    const records: InstanceRecord[] = readInstanceRecords({ dir: options.registryDir });
    for (const pid of pids) {
      const verdict = await verifyOwnership({
        pid,
        expected: {
          service: serviceKey,
          runId: expectedIdentity.runId,
          checkout: expectedIdentity.checkout,
        },
        records,
        inspector: options.inspector,
      });
      if (verdict.owned) {
        return {
          ready: true,
          observedIdentity: expectedIdentity,
          validatedProcess: verdict.identity,
        };
      }
    }

    // A fresh hub-worker has no record yet. Bootstrap one only when the exact
    // listener PID is also reported by the trusted service pane and its cwd
    // matches the expected checkout. This breaks the record-before-readiness
    // cycle without allowing an unrelated listener to mint its own authority.
    for (const pid of pids) {
      if (!context?.panePids.includes(pid) || !expectedIdentity.checkout) {
        continue;
      }
      const [pidStartTimeMs, cwd] = await Promise.all([
        options.inspector.startTimeMs(pid),
        options.inspector.cwd(pid),
      ]);
      if (
        pidStartTimeMs === undefined ||
        cwd === undefined ||
        !isWithinCheckout(cwd, expectedIdentity.checkout)
      ) {
        continue;
      }
      // The identity read here IS the validation (this PID is the pane's own
      // listener inside our checkout), so it is returned as the evidence the
      // recorder persists.
      return {
        ready: true,
        observedIdentity: expectedIdentity,
        validatedProcess: { pid, pidStartTimeMs },
      };
    }
    return { ready: false, reason: `${serviceKey} on :${port} is not a verified owned instance` };
  };
