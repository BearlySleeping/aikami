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
import { readInstanceRecords } from './instance_registry.ts';
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
  const ports = [
    PORTS.emulator.client,
    PORTS.emulator.hub,
    PORTS.emulator.site,
    PORTS.emulator.auth,
    PORTS.emulator.functions,
    PORTS.emulator.hosting,
    PORTS.emulator.pubsub,
    PORTS.emulator.storage,
    PORTS.emulator.emulatorHub,
  ];
  await Promise.all(ports.map((port) => killPort(port + offset, expected).catch(() => {})));
};

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
 * True when a pane's own processes are provably owned by a DIFFERENT checkout
 * or run.
 *
 * 🔴 The workspace label is contract-scoped, not run-scoped
 * (`aikami-contract-C-XXX`), so two runs of one contract share it. Closing a
 * service tab therefore has to distinguish "this checkout's dev server" from
 * "another run's". Only POSITIVE evidence of foreign ownership blocks the
 * close: a pane the pipeline started always has a record, so a concurrent run's
 * tabs are protected, while a service started by hand (no record) is still
 * cleaned up and the removal stays deterministic.
 */
const ownedByAnotherCheckout = async (options: {
  paneId: string;
  expected: { runId: string | undefined; checkout: string };
}): Promise<boolean> => {
  const panePids = await paneProcessIds(options.paneId).catch((): number[] => []);
  if (panePids.length === 0) {
    return false;
  }
  return readInstanceRecords().some(
    (record) =>
      panePids.includes(record.pid) &&
      (record.checkout !== options.expected.checkout || record.runId !== options.expected.runId),
  );
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
      await herdr(['tab', 'close', tab.tab_id]).catch(() => {});
    }
  }
  // Belt and braces: a server that outlived its pane still holds the port
  // (and its cwd inside the checkout). killPort only kills processes backed by
  // a verified ownership record for this checkout/run, never a bystander.
  await killContractPorts(checkoutPath);
};
