// scripts/src/lib/agents/contract_pipeline/postconditions.ts
import { basename, relative, resolve } from 'node:path';
import { changedBetweenSnapshots } from './git_state.ts';
import type { ContractWorkerRole, GitStateSnapshot } from './types.ts';

/** Validate role-specific filesystem boundaries after a worker attempt. */
export const validatePostconditions = (options: {
  role: ContractWorkerRole;
  contractPath: string;
  repoRoot: string;
  before: GitStateSnapshot;
  after: GitStateSnapshot;
}): { passed: boolean; unauthorizedPaths: string[]; changedPaths: string[] } => {
  const changed = changedBetweenSnapshots({ before: options.before, after: options.after });
  const relativeContractPath = relative(options.repoRoot, resolve(options.contractPath)).replaceAll(
    '\\',
    '/',
  );

  // Critic is read-only — the Pi extension guard blocks write/edit/bash mutations.
  // A git snapshot comparison would false-positive on files the critic merely read.
  if (options.role === 'critic') {
    return { passed: true, unauthorizedPaths: [], changedPaths: changed };
  }

  let unauthorizedPaths: string[] = [];
  if (options.role === 'writer' || options.role === 'verifier') {
    // The contract path may be a placeholder (C-315.md) while the actual
    // contract file created by contract_generate has a full slug
    // (C-315-define-versioned-....md). Match by contract ID prefix.
    const contractFileName = basename(options.contractPath);
    const contractId = contractFileName.match(/^(C-\d+|MIG-\d+)/)?.[0];

    unauthorizedPaths = changed.filter((path) => {
      if (path === relativeContractPath) {
        return false; // Exact match (placeholder) — allowed
      }
      // docs/ is a separate gitignored repo — stray files (e.g. TODO_DRAFT.md)
      // that are NOT contract files should not block the verifier/writer.
      if (path.startsWith('docs/') && !path.startsWith('docs/contracts/')) {
        return false;
      }
      if (contractId && path.startsWith('docs/contracts/')) {
        const fileName = basename(path);
        // Allow the placeholder (C-315.md) or the slugged name (C-315-*.md)
        if (fileName === `${contractId}.md` || fileName.startsWith(`${contractId}-`)) {
          return false; // Pattern match — allowed
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
