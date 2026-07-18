// scripts/src/lib/agents/contract_pipeline/postconditions.ts
//
// Validate role-specific filesystem boundaries after a worker attempt.
// For implementer/verifier (which run in a Git Worktree), diffs are captured
// from the worktree, not the root repo, to avoid false boundary violations.
import { basename, relative, resolve } from 'node:path';
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
  const relativeContractPath = relative(options.repoRoot, resolve(options.contractPath)).replaceAll(
    '\\',
    '/',
  );

  // Critic edits only the contract file — the Pi extension guard blocks all
  // other write/edit mutations, and a git snapshot comparison would
  // false-positive on manifest/status churn. Critic is exempt here.
  if (options.role === 'critic') {
    return { passed: true, unauthorizedPaths: [], changedPaths: changed };
  }

  let unauthorizedPaths: string[] = [];
  const PipelineManagedFiles = new Set([
    '.envrc',
    '.pi/settings.json',
    '.context/llms.txt',
    'docs/contracts/PROGRESS.md',
    'docs/contracts/PROMOTION.md',
  ]);

  // Verifier can fix trivial issues — no file restrictions.
  if (options.role === 'implementer' || options.role === 'verifier') {
    return { passed: true, unauthorizedPaths: [], changedPaths: changed };
  }

  if (options.role === 'writer') {
    const contractFileName = basename(options.contractPath);
    const contractId = contractFileName.match(/^(C-\d+|MIG-\d+)/)?.[0];

    unauthorizedPaths = changed.filter((path) => {
      if (path === relativeContractPath) {
        return false;
      }
      if (PipelineManagedFiles.has(path)) {
        return false;
      }
      // docs/ is a separate gitignored repo — non-contract docs/ files are fine.
      if (path.startsWith('docs/') && !path.startsWith('docs/contracts/')) {
        return false;
      }
      if (contractId && path.startsWith('docs/contracts/')) {
        const fileName = basename(path);
        if (fileName === `${contractId}.md` || fileName.startsWith(`${contractId}-`)) {
          return false;
        }
      }
      return true;
    });
  }

  return {
    passed: unauthorizedPaths.length === 0,
    unauthorizedPaths,
    changedPaths: changed,
  };
};
