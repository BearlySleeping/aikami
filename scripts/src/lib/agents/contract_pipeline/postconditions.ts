// scripts/src/lib/agents/contract_pipeline/postconditions.ts
//
// Validate role-specific filesystem boundaries after a worker attempt.
//
// Boundary model (enforced even when the per-role `--tools` whitelist is
// disabled, see herdr_adapter.toolsForRole / worker.activeTools):
//   - writer  (write_contract): may only modify the contract file itself.
//   - critic  (critique):       read-only — feedback is recorded via
//                               contract_stage_complete (run state), never
//                               by editing repo files.
//   - implement / verify:       work broadly in the worktree; no boundary.
//
// Known regenerated paths (moon tasks, paraglide, vite, lockfiles) are
// exempt so legitimate tooling side-effects don't produce false positives.
import { relative, resolve } from 'node:path';
import { changedBetweenSnapshots } from './git_state.ts';
import type { ContractWorkerRole, GitStateSnapshot } from './types.ts';

/** Regenerated/transient paths that tooling may touch without a violation. */
const EXEMPT_PATH_PATTERNS: RegExp[] = [
  /^bun\.lock$/,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^package\.json$/,
  /^src\/paraglide\//,
  /^node_modules\/\.vite\//,
  /^\.svelte-kit\//,
  /^\.moon\/cache\//,
  /^packages\/frontend\/dataconnect\/src\/lib\/generated\//,
];

const isExempt = (path: string): boolean =>
  EXEMPT_PATH_PATTERNS.some((pattern) => pattern.test(path));

/** Resolve a snapshot-relative path to an absolute path in the run's cwd. */
const absPath = (options: { repoRoot: string; workspacePath?: string; path: string }): string =>
  resolve(options.workspacePath ?? options.repoRoot, options.path);

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

  // Implement/verify legitimately touch implementation code — no boundary.
  if (options.role !== 'writer' && options.role !== 'critic') {
    return { passed: true, unauthorizedPaths: [], changedPaths: changed };
  }

  const contractAbs = absPath({
    repoRoot: options.repoRoot,
    workspacePath: options.workspacePath,
    path: relative(options.repoRoot, options.contractPath),
  });

  const unauthorized = changed.filter((path) => {
    if (isExempt(path)) {
      return false;
    }
    if (options.role === 'writer') {
      // Writer may only touch the contract file.
      return (
        absPath({ repoRoot: options.repoRoot, workspacePath: options.workspacePath, path }) !==
        contractAbs
      );
    }
    // Critic is read-only — any repo mutation is a violation.
    return true;
  });

  return {
    passed: unauthorized.length === 0,
    unauthorizedPaths: unauthorized,
    changedPaths: changed,
  };
};
