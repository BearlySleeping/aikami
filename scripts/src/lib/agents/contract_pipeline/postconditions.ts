// scripts/src/lib/agents/contract_pipeline/postconditions.ts
import { relative, resolve } from 'node:path';
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
  if (options.role === 'writer') {
    unauthorizedPaths = changed.filter((path) => path !== relativeContractPath);
  } else if (options.role === 'verifier') {
    unauthorizedPaths = changed.filter((path) => path !== relativeContractPath);
  }

  return {
    passed: unauthorizedPaths.length === 0,
    unauthorizedPaths,
    changedPaths: changed,
  };
};
