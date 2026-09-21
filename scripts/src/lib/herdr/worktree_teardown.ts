// scripts/src/lib/herdr/worktree_teardown.ts
//
// 🔴 Safe disposal of a worktree checkout — everything that must happen
// BEFORE (and around) `removeWorktree`'s own removal attempt.
//
// Why this is a module of its own: removing a worktree is the one destructive
// path in the herdr lifecycle, and it carries three hazards that have nothing
// to do with *provisioning* a checkout (which is what worktree.ts is about):
//
//   1. A dev server still running with its cwd INSIDE the checkout keeps
//      writing into `.svelte-kit`/`node_modules` while the removal is in
//      flight, so `git worktree remove` sees a dirty tree and refuses —
//      leaving an orphan behind. `stopServicesInCheckout` closes the
//      contract's dev-service tabs.
//   2. A server can outlive its pane and keep holding the port (and its cwd)
//      after the tabs are gone. `killContractPorts` is the belt and braces.
//   3. The `rmSync` fallback must never be pointed at the repo root or at a
//      plain directory. `assertManagedWorktreeTarget` refuses both.
//
// 🔴 Ownership is PROVEN here, never assumed. `killPort` terminates a process
// only when a persisted `InstanceRecord` matches this exact service/run/
// checkout AND the live PID still carries the recorded creation identity (see
// instance_registry.ts). The expected identity is therefore derived from the
// checkout being TORN DOWN — never from the controller's ambient environment —
// so cleaning up another contract's worktree can never be authorized by this
// process's own ownership record, and vice versa.
//
// Extracted from worktree.ts (source-size ratchet); behaviour is unchanged.
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contractPortOffset, PORTS } from '@aikami/constants';
import { processCwd, processStartTimeMs } from '../env/process_info';
import { reportInfraIssue } from '../ops/infra_report.ts';
import {
  type InstanceRecord,
  type ProcessInspector,
  readInstanceRecords,
  verifyOwnership,
} from './instance_registry.ts';
import {
  CONTRACT_WORKSPACE_PREFIX,
  contractIdFromWorktreePath,
  findWorkspace,
  getWorkspacePanes,
  getWorkspaceTabs,
  herdr,
  KNOWN_SERVICES,
  killPort,
  paneProcessIds,
  runIdFromWorktreePath,
  SERVICE_DEFS,
} from './session.ts';

/** Live process identity, so an ownership record can be checked against the PID as it is now. */
const ownershipInspector: ProcessInspector = {
  startTimeMs: (pid) => processStartTimeMs(pid),
  cwd: (pid) => processCwd(pid),
};

/**
 * The ownership identity that a checkout's OWN processes must match.
 *
 * 🔴 Derived from `checkoutPath` alone — never from this process's ambient
 * `CONTRACT_PIPELINE_RUN_ID`/contract. Cleaning up contract A's worktree while
 * running inside contract B must look for A's record, and B's record must not
 * authorize terminating A's (or anyone else's) process. `runId` is the exact
 * run encoded in the worktree slug, falling back to the contract id, then to
 * undefined (which matches any run, but still pins the checkout).
 */
export const expectedOwnershipForCheckout = (
  checkoutPath: string,
): { runId: string | undefined; checkout: string } => {
  const contractId = checkoutPath.match(/(c-\d+|mig-\d+)/i)?.[0];
  return {
    runId:
      runIdFromWorktreePath(checkoutPath) ?? contractIdFromWorktreePath(checkoutPath) ?? contractId,
    checkout: checkoutPath,
  };
};

/**
 * Last resort: free a finished contract's dev-server ports so a leftover
 * `client` doesn't block the next contract on the same offset. Derives the
 * contract ID from the worktree folder name (`contract-task-c-379-msqg9jqx`,
 * case-insensitive) and frees ONLY processes backed by a verified ownership
 * record matching this checkout/run. Best-effort: never throws.
 */
export const killContractPorts = async (checkoutPath: string): Promise<void> => {
  const contractId = checkoutPath.match(/(c-\d+|mig-\d+)/i)?.[0];
  const offset = contractPortOffset(contractId);
  if (offset === 0) {
    return;
  }
  // A record for a DIFFERENT checkout/run must not authorize a kill here, so
  // the expectation is read from `checkoutPath` — the tree being torn down —
  // rather than from the ambient contract/run this process happens to be in.
  const expected = expectedOwnershipForCheckout(checkoutPath);
  await Promise.all(
    CONTRACT_TEARDOWN_PORTS.map((port) => killPort(port + offset, expected).catch(() => {})),
  );
};

/**
 * Every emulator port a contract's own dev services can bind, at its UNSHIFTED
 * base (`contractPortOffset` is added by the caller).
 *
 * 🔴 This must cover EVERY offsettable emulator port — `hub-worker` included.
 * Omitting one means a server that outlived its pane keeps holding
 * `base + offset` and blocks the NEXT contract on the same offset, which is the
 * whole reason this sweep exists. `worktree_teardown.test.ts` pins the list
 * against `OFFSETTABLE_PORTS`, so a newly offsettable service cannot be
 * silently forgotten here.
 */
export const CONTRACT_TEARDOWN_PORTS: readonly number[] = [
  PORTS.emulator.client,
  PORTS.emulator.hub,
  PORTS.emulator.hubWorker,
  PORTS.emulator.site,
  PORTS.emulator.auth,
  PORTS.emulator.functions,
  PORTS.emulator.hosting,
  PORTS.emulator.pubsub,
  PORTS.emulator.storage,
  PORTS.emulator.emulatorHub,
];

/**
 * Refuse the rmSync removal fallback unless `checkoutPath` is a genuine
 * non-root git-linked worktree. Two checks, both must pass:
 *  1. canonical checkoutPath !== canonical repoRoot (case-insensitive on
 *     Windows) — rmSync(repoRoot) would recursively delete the ENTIRE repo.
 *  2. a `.git` FILE marker exists at the target — linked worktrees get a
 *     `.git` file (gitdir: ...), while repo roots get a `.git` directory;
 *     without the marker the target is not a managed git worktree and
 *     rmSync would eat arbitrary user data.
 */
export const assertManagedWorktreeTarget = (checkoutPath: string, repoRoot: string): void => {
  const canonicalPath = realpathSync.native(checkoutPath);
  const canonicalRoot = realpathSync.native(repoRoot);
  const samePath =
    process.platform === 'win32'
      ? canonicalPath.toLowerCase() === canonicalRoot.toLowerCase()
      : canonicalPath === canonicalRoot;
  if (samePath) {
    throw new Error(
      `refusing to rm -rf ${checkoutPath}: it equals the repo root (${repoRoot}) — ` +
        'this would delete the entire repository.',
    );
  }
  let gitMarker: ReturnType<typeof statSync> | undefined;
  try {
    gitMarker = statSync(join(checkoutPath, '.git'));
  } catch {
    gitMarker = undefined;
  }
  if (!gitMarker?.isFile()) {
    throw new Error(
      `refusing to rm -rf ${checkoutPath}: no git-worktree .git marker file found — ` +
        'the target is not a non-root managed git worktree.',
    );
  }
};

/**
 * True when any of `pids` is VERIFIABLY owned by a DIFFERENT checkout or run.
 *
 * Pure-ish (the inspector is injected) so the classification the teardown
 * guard depends on is unit-testable without a live Herdr.
 *
 * A record only counts as evidence once the LIVE process is verified against
 * it: a stale record whose PID has since been reused must not make our own
 * server look foreign, or teardown would leave a live server behind and the
 * removal would fail.
 */
export const recordsAreForeign = async (options: {
  pids: readonly number[];
  records: readonly InstanceRecord[];
  inspector: ProcessInspector;
  expected: { runId: string | undefined; checkout: string };
}): Promise<boolean> => {
  for (const pid of options.pids) {
    // 🔴 Evaluate EVERY record for this PID individually. `verifyOwnership`
    // picks ONE candidate (the first matching the expectation, else the first)
    // and compares the live start time against only that one — so with two
    // records for the same PID (e.g. `client-4242` stale and `hub-4242` live)
    // a stale record could shadow the live foreign one and hide the owner.
    // `readInstanceRecords` returns filesystem order, which is not stable.
    for (const candidate of options.records.filter((record) => record.pid === pid)) {
      const verdict = await verifyOwnership({
        pid,
        records: [candidate],
        inspector: options.inspector,
      });
      if (!verdict.owned) {
        continue;
      }
      if (
        verdict.record.checkout !== options.expected.checkout ||
        verdict.record.runId !== options.expected.runId
      ) {
        return true;
      }
    }
  }
  return false;
};

/**
 * True when a pane's own processes are VERIFIABLY owned by a DIFFERENT
 * checkout or run.
 *
 * 🔴 The workspace label is contract-scoped, not run-scoped
 * (`aikami-contract-C-XXX`), so two runs of one contract share it. Closing a
 * service tab therefore has to distinguish "this checkout's dev server" from
 * "another run's".
 *
 * The rule is "close unless there is POSITIVE evidence the pane is foreign",
 * not "close only when ownership is proven":
 *
 *   - A pane the pipeline started always has a record, so a concurrent run's
 *     service tabs are protected — the harm this guard exists to prevent.
 *   - A service started BY HAND (no record) is still closed, which keeps the
 *     removal deterministic. Requiring proof of ownership would leave a live
 *     vite writing into the checkout and `git worktree remove` would fail —
 *     the exact "cannot delete worktree" failure this function exists to fix.
 */
const ownedByAnotherCheckout = async (options: {
  paneId: string;
  expected: { runId: string | undefined; checkout: string };
}): Promise<boolean> => {
  const panePids = await paneProcessIds(options.paneId).catch((): number[] => []);
  if (panePids.length === 0) {
    return false;
  }
  return recordsAreForeign({
    pids: panePids,
    records: readInstanceRecords(),
    inspector: ownershipInspector,
    expected: options.expected,
  });
};

/**
 * Close one service tab — best-effort, but NOT silent.
 *
 * 🔴 `herdr()` RESOLVES on a non-zero exit code; it only rejects on a spawn
 * error or a timeout. A bare `.catch()` therefore hides a failed close, and
 * the pane (with its dev server) survives into the removal and shows up later
 * as an inexplicable "cannot delete worktree". The exit code is inspected so
 * that failure is diagnosable at the point it happens.
 */
const closeServiceTab = async (tabId: string): Promise<void> => {
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await herdr(['tab', 'close', tabId]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  herdr tab close ${tabId} failed: ${message}`);
    reportInfraIssue({
      component: 'worktree_teardown',
      operation: `close service tab ${tabId}`,
      error: error instanceof Error ? error : new Error(message),
      context: { tabId },
    });
    return;
  }
  if (result.code === 0) {
    return;
  }
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 300);
  console.warn(`⚠️  herdr tab close ${tabId} exited ${result.code}: ${detail}`);
  reportInfraIssue({
    component: 'worktree_teardown',
    operation: `close service tab ${tabId}`,
    error: new Error(`herdr tab close exited ${result.code}: ${detail}`),
    context: { tabId, code: result.code },
  });
};

/**
 * Stop everything the contract owns that would otherwise still be running
 * INSIDE the checkout when we try to delete it.
 *
 * 🔴 This is the single biggest cause of "cannot delete worktree". Dev
 * services started from an implementer/verifier/review tab run with their cwd
 * inside the checkout (that is the point — they serve the branch's code), and
 * a live vite keeps writing into `.svelte-kit`/`node_modules` while the
 * removal is in flight. `git worktree remove` then reports the tree as
 * modified and refuses, and herdr's own right-click "delete worktree" — which
 * does not force — fails the same way. Killing the services first turns a
 * flaky removal into a deterministic one.
 *
 * Best-effort throughout: this runs ahead of a removal that must proceed
 * regardless, so nothing here throws.
 */
export const stopServicesInCheckout = async (checkoutPath: string): Promise<void> => {
  const contractId = checkoutPath.match(/(C-\d+|MIG-\d+)/i)?.[0]?.toUpperCase();
  if (!contractId) {
    return;
  }
  // One workspace per contract (CONTRACT_WORKSPACE_PREFIX) — closing its
  // dev-service tabs kills the pane shells and, with them, the servers.
  const workspaceId = await findWorkspace(`${CONTRACT_WORKSPACE_PREFIX}${contractId}`).catch(
    () => null,
  );
  if (workspaceId) {
    const serviceNames = new Set(KNOWN_SERVICES.map((service) => SERVICE_DEFS[service].name));
    const expected = expectedOwnershipForCheckout(checkoutPath);
    const panes = await getWorkspacePanes(workspaceId).catch(
      (): { pane_id: string; tab_id: string }[] => [],
    );
    for (const tab of await getWorkspaceTabs(workspaceId).catch(() => [])) {
      if (!serviceNames.has(tab.label)) {
        continue;
      }
      // Leave another run's verified-owned service tab alone; see
      // ownedByAnotherCheckout.
      const pane = panes.find((candidate) => candidate.tab_id === tab.tab_id);
      if (pane && (await ownedByAnotherCheckout({ paneId: pane.pane_id, expected }))) {
        continue;
      }
      await closeServiceTab(tab.tab_id);
    }
  }
  // Belt and braces: a server that outlived its pane still holds the port
  // (and its cwd inside the checkout). killPort only kills processes backed by
  // a verified ownership record for this checkout/run, never a bystander.
  await killContractPorts(checkoutPath);
};
