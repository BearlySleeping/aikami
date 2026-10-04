// scripts/src/lib/herdr/service_tab_ownership.ts

import { processCwd, processStartTimeMs } from '../env/process_info.ts';
import {
  type ExpectedOwnership,
  type InstanceRecord,
  type ProcessInspector,
  readInstanceRecords,
  recheckProcessIdentity,
  recordInstance,
  verifyOwnership,
} from './instance_registry.ts';

/** Refuse destructive pane actions unless every foreground PID is proved run-owned. */
export const assertServiceTabOwnership = async (options: {
  panePids: readonly number[];
  unresolvedPane?: boolean;
  idlePanes?: readonly { paneId: string; pid: number }[];
  expected: ExpectedOwnership;
  records?: readonly InstanceRecord[];
  inspector?: ProcessInspector;
}): Promise<void> => {
  const records = options.records ?? readInstanceRecords();
  const inspector = options.inspector ?? { startTimeMs: processStartTimeMs, cwd: processCwd };
  if (
    options.unresolvedPane ||
    (options.panePids.length === 0 && !options.idlePanes?.length) ||
    !options.expected.checkout ||
    !options.expected.service
  ) {
    throw new Error('Service tab ownership is unverified; inspect and clean up manually.');
  }
  const service = options.expected.service;
  const candidates = [
    ...options.panePids.map((pid) => ({ pid, expected: options.expected })),
    ...(options.idlePanes ?? []).map(({ paneId, pid }) => ({
      pid,
      expected: { ...options.expected, service: paneRecordService(service, paneId) },
    })),
  ];
  for (const candidate of candidates) {
    await assertOwnedProcess({ ...candidate, records, inspector });
  }
};

// Pane shell records are separate from service records: they cannot prove readiness.
const paneRecordService = (service: string, paneId: string): string => `${service}:pane:${paneId}`;

/** Capture the shell identity only for a pane this invocation just created. */
export const recordCreatedServicePane = async (options: {
  paneId: string;
  shellPids: readonly number[];
  expected: ExpectedOwnership;
  startTimeMs?: ProcessInspector['startTimeMs'];
  dir?: string;
}): Promise<void> => {
  if (!options.expected.service || !options.expected.checkout) {
    return;
  }
  for (const pid of options.shellPids) {
    const pidStartTimeMs = await (options.startTimeMs ?? processStartTimeMs)(pid);
    if (pidStartTimeMs === undefined) {
      continue;
    }
    recordInstance({
      dir: options.dir,
      record: {
        ...options.expected,
        service: paneRecordService(options.expected.service, options.paneId),
        scope: 'run',
        pid,
        pidStartTimeMs,
        startedAt: new Date().toISOString(),
      },
    });
  }
};

const assertOwnedProcess = async (options: {
  pid: number;
  expected: ExpectedOwnership;
  records: readonly InstanceRecord[];
  inspector: ProcessInspector;
}): Promise<void> => {
  const { pid, expected, records, inspector } = options;
  const verdict = await verifyOwnership({ pid, expected, records, inspector });
  if (!verdict.owned || verdict.record.scope !== 'run') {
    const reason = verdict.owned ? 'shared/external process' : verdict.reason;
    throw new Error(`Refusing service tab action: PID ${pid} ownership is unverified (${reason}).`);
  }
  // verifyOwnership treats an omitted runId as a wildcard. Ad-hoc captains
  // must not gain control of a pipeline-owned process in the same checkout.
  if (verdict.record.runId !== expected.runId) {
    throw new Error(`Refusing service tab action: PID ${pid} belongs to another run.`);
  }
  const recheck = await recheckProcessIdentity({ identity: verdict.identity, inspector });
  if (!recheck.matches) {
    throw new Error(`Refusing service tab action: PID ${pid} identity changed or is unavailable.`);
  }
};
