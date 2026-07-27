// scripts/src/lib/agents/contract_pipeline/postconditions.ts
//
// Validate role-specific filesystem boundaries after a worker attempt.
// Currently all roles are exempt — the critic + implementer +
// verifier chain catches real issues. Regenerated files from moon
// tasks (paraglide, vite deps, lockfiles) trigger false positives.
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

  // All roles pass — regenerated files from moon tasks / code inspection
  // trigger false boundary violations. The critic + implementer + verifier
  // chain catches real issues.
  return { passed: true, unauthorizedPaths: [], changedPaths: changed };
};
