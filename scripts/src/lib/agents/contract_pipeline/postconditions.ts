// scripts/src/lib/agents/contract_pipeline/postconditions.ts
//
// Validate role-specific filesystem boundaries after a worker attempt.
// For implementer/verifier (which run in a Git Worktree), diffs are captured
// from the worktree, not the root repo, to avoid false boundary violations.
import { existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
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
  const PipelineManagedFiles = new Set(['.envrc', '.pi/settings.json']);

  // Implementer: validate that every claimed file actually exists on disk.
  // Prevents "ghost files" — implementer lists files in contract_stage_complete
  // that were never actually written.
  if (options.role === 'implementer') {
    const wsRoot = options.workspacePath ?? options.repoRoot;
    const missing = changed.filter(
      (path) => !existsSync(join(wsRoot, path)) && !PipelineManagedFiles.has(path),
    );
    // Only flag files that were CLAIMED (in the implementer's filesTouched)
    // but don't exist on disk. Untracked files in changed that DO exist are fine
    // — the pipeline commits them after implementer passes.
    return {
      passed: missing.length === 0,
      unauthorizedPaths: missing,
      changedPaths: changed,
    };
  }

  if (options.role === 'writer' || options.role === 'verifier') {
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
