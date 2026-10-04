// scripts/src/lib/herdr/service_tab_ownership.ts

import { processCwd, processStartTimeMs } from '../env/process_info.ts';
import {
  type ExpectedOwnership,
  type InstanceRecord,
  type ProcessInspector,
  readInstanceRecords,
  recheckProcessIdentity,
  verifyOwnership,
} from './instance_registry.ts';

/** Refuse destructive pane actions unless every foreground PID is proved run-owned. */
export const assertServiceTabOwnership = async (options: {
  panePids: readonly number[];
  unresolvedPane?: boolean;
  expected: ExpectedOwnership;
  records?: readonly InstanceRecord[];
  inspector?: ProcessInspector;
}): Promise<void> => {
  const records = options.records ?? readInstanceRecords();
  const inspector = options.inspector ?? { startTimeMs: processStartTimeMs, cwd: processCwd };
  if (
    options.unresolvedPane ||
    options.panePids.length === 0 ||
    !options.expected.checkout ||
    !options.expected.service
  ) {
    throw new Error('Service tab ownership is unverified; inspect and clean up manually.');
  }
  for (const pid of options.panePids) {
    const verdict = await verifyOwnership({ pid, expected: options.expected, records, inspector });
    if (!verdict.owned || verdict.record.scope !== 'run') {
      const reason = verdict.owned ? 'shared/external process' : verdict.reason;
      throw new Error(
        `Refusing service tab action: PID ${pid} ownership is unverified (${reason}).`,
      );
    }
    // verifyOwnership treats an omitted runId as a wildcard. Ad-hoc captains
    // must not gain control of a pipeline-owned process in the same checkout.
    if (verdict.record.runId !== options.expected.runId) {
      throw new Error(`Refusing service tab action: PID ${pid} belongs to another run.`);
    }
    const recheck = await recheckProcessIdentity({ identity: verdict.identity, inspector });
    if (!recheck.matches) {
      throw new Error(
        `Refusing service tab action: PID ${pid} identity changed or is unavailable.`,
      );
    }
  }
};
