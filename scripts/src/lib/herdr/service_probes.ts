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

import type { DevService } from '@aikami/constants';
import {
  type InstanceRecord,
  type ProcessInspector,
  readInstanceRecords,
  recordInstance,
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
    };
  } catch {
    return undefined;
  }
};

/**
 * Build a recorder that persists an ownership record for a service that just
 * became ready. Resolves the listening PID from the ready port and captures
 * its CREATION IDENTITY (absolute start time), so a later `killPort` can prove
 * the process is the one we started rather than a PID-reused stranger.
 * Best-effort: a failed lookup (no `ss`/`lsof`, a race) leaves the service
 * non-killable, which is the safe direction.
 */
export const makeInstanceRecorder =
  (options: {
    listPids: PidLister;
    startTimeMs: (pid: number) => Promise<number | undefined>;
    scopeOf: (service: DevService) => InstanceRecord['scope'];
    currentRunId: () => string | undefined;
    checkout: () => string;
  }) =>
  async (entry: { service: DevService; port: number }): Promise<void> => {
    const pids = await options.listPids(entry.port);
    const pid = pids[0];
    if (pid === undefined) {
      return;
    }
    const startTimeMs = await options.startTimeMs(pid);
    if (startTimeMs === undefined) {
      return;
    }
    const record: InstanceRecord = {
      service: entry.service,
      scope: options.scopeOf(entry.service),
      runId: options.currentRunId(),
      checkout: options.checkout(),
      pid,
      pidStartTimeMs: startTimeMs,
      port: entry.port,
      startedAt: new Date().toISOString(),
    };
    recordInstance({ record });
  };

/**
 * Build an instance-bound probe for a run-owned service that serves the dev
 * identity endpoint. A responsive server from another checkout reports a
 * different `checkout` and is rejected by the readiness verifier.
 */
export const makeAppIdentityProbe =
  (resolvePort: ProbePortResolver) =>
  (serviceKey: DevService): NonNullable<ServiceDef['probe']> =>
  async (): Promise<ProbeResult> => {
    const port = resolvePort(serviceKey);
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
    return { ready: true, observedIdentity };
  };

/**
 * Build an instance-bound probe for a run-owned service that CANNOT serve an
 * identity endpoint. Verifies the listening PID against the persisted
 * ownership record — same service, run, and checkout, and same PID creation
 * identity. A server we did not start has no matching record and is rejected.
 */
export const makeListenerOwnershipProbe =
  (options: { resolvePort: ProbePortResolver; listPids: PidLister; inspector: ProcessInspector }) =>
  (serviceKey: DevService): NonNullable<ServiceDef['probe']> =>
  async (expectedIdentity: ServiceIdentity): Promise<ProbeResult> => {
    const port = options.resolvePort(serviceKey);
    if (port === undefined) {
      return { ready: false, reason: `${serviceKey} has no ready port defined` };
    }
    const pids = await options.listPids(port);
    if (pids.length === 0) {
      return { ready: false, reason: `${serviceKey} is not listening on :${port}` };
    }
    const records: InstanceRecord[] = readInstanceRecords();
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
        return { ready: true, observedIdentity: expectedIdentity };
      }
    }
    return { ready: false, reason: `${serviceKey} on :${port} is not a verified owned instance` };
  };
