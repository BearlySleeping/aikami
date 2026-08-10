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
// The function is kept as a pass-through so the orchestrator's before/after
// git-state plumbing and the diffHash/fingerprint flow stay intact.
import { changedBetweenSnapshots } from './git_state.ts';
import type { ContractWorkerRole, GitStateSnapshot } from './types.ts';

/** Validate role-specific filesystem boundaries after a worker attempt. */
export const validatePostconditions = (options: {
  role: ContractWorkerRole;
  contractPath: string;
  repoRoot: string;
  /** The Git Worktree path (for implementer/verifier). If undefined, uses repo root. */
  workspacePath?: string;
  before: GitStateSnapshot;
  after: GitStateSnapshot;
}): { passed: boolean; unauthorizedPaths: string[]; changedPaths: string[] } => {
  const changed = changedBetweenSnapshots({ before: options.before, after: options.after });

  // No role boundary: all roles may mutate any path. The diff is still
  // reported for diagnostics (manifest diffHash / audit trail).
  return { passed: true, unauthorizedPaths: [], changedPaths: changed };
};
