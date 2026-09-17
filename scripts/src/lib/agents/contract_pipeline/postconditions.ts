// scripts/src/lib/agents/contract_pipeline/postconditions.ts
//
// Post-stage filesystem validation.
//
// 🔴 RELAXED 2026-08-10: the per-role filesystem boundary was removed.
// Previously: writer could only modify the contract file; critic was
// read-only; violations failed the stage. This over-constrained the agents —
// e.g. the writer writing a scratch analysis file under .pi/contract-runs/
// was treated as a boundary violation. Role behavior is now prompt-governed
// (contract-create / contract-critique prompts state what each role may and
// may not do). If a role misbehaves, fix the prompt — don't re-add hard
// boundaries.
//
// 🔴 HONESTY (C-472-family brief, P1). This function used to return
// `{ passed: true, unauthorizedPaths: [] }` unconditionally and the
// orchestrator reported it as "postcondition validation — catches agents
// crossing role boundaries". That was a misleading claim: no boundary is
// enforced here at all, so `unauthorizedPaths` was always empty BY
// CONSTRUCTION, not because the stage was clean. The `enforced` flag below
// makes the absence of enforcement explicit, so no caller or log can present
// a vacuous pass as a boundary guarantee.
//
// The diff IS still computed and returned — it feeds the manifest diffHash and
// the audit trail, which is the genuinely useful part of this module.
import { changedBetweenSnapshots } from './git_state.ts';
import type { ContractWorkerRole, GitStateSnapshot } from './types.ts';

/** Result of a post-stage postcondition check. */
export type PostconditionResult = {
  /**
   * Always true today: filesystem role boundaries are NOT enforced (see the
   * header). Kept as a field so callers keep a single, explicit gate to read —
   * but it must never be described as a boundary check.
   */
  passed: boolean;
  /**
   * 🔴 Always false today. A `true` here is the ONLY thing that would make
   * `passed: false` meaningful; because boundaries are prompt-governed, this
   * stays false and `unauthorizedPaths` is necessarily empty.
   */
  enforced: boolean;
  /** Paths a role was not permitted to change — empty because nothing is enforced. */
  unauthorizedPaths: string[];
  /** Every path that changed between the snapshots (diagnostics/audit). */
  changedPaths: string[];
};

/** Validate role-specific filesystem boundaries after a worker attempt. */
export const validatePostconditions = (options: {
  role: ContractWorkerRole;
  contractPath: string;
  repoRoot: string;
  /** The Git Worktree path (for implementer/verifier). If undefined, uses repo root. */
  workspacePath?: string;
  before: GitStateSnapshot;
  after: GitStateSnapshot;
}): PostconditionResult => {
  const changed = changedBetweenSnapshots({ before: options.before, after: options.after });

  // No role boundary: all roles may mutate any path. The diff is still
  // reported for diagnostics (manifest diffHash / audit trail), but this is
  // NOT a boundary check — `enforced: false` says so out loud.
  return { passed: true, enforced: false, unauthorizedPaths: [], changedPaths: changed };
};
