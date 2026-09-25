// scripts/src/lib/herdr/worktree_environment.ts
//
// Worktree-local direnv preparation. The generated .envrc delegates to the
// main checkout so the Git-tracked Nix shell remains the single source of
// truth, then explicitly trusts that file before bootstrap reports readiness.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasDirenv } from '../env/direnv_detect';
import { posixQuote } from '../env/which.ts';
import { reportInfraIssue } from '../ops/infra_report.ts';

/**
 * Write and trust the worktree delegation file.
 *
 * A missing direnv binary remains a supported degraded mode, but a failed
 * `direnv allow` is fatal when direnv is installed: otherwise bootstrap would
 * report a worktree ready even though its promised shell environment is not
 * available.
 */
export const prepareWorktreeEnvironment = (options: {
  checkoutPath: string;
  repoRoot: string;
}): void => {
  const { checkoutPath, repoRoot } = options;
  const direnvAvailable = hasDirenv();
  writeFileSync(
    join(checkoutPath, '.envrc'),
    `# Worktree direnv — delegate to repo root where flake.nix is Git-tracked
source_env ${posixQuote(repoRoot)}
export CONTRACT_PIPELINE_WORKTREE=1
`,
  );

  try {
    // Always run this command. The only tolerated failure is the unsupported
    // machine without direnv, which is handled below.
    execSync('direnv allow', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: checkoutPath,
      timeout: 5000,
      windowsHide: true,
    });
  } catch (error: unknown) {
    if (direnvAvailable) {
      reportInfraIssue({
        component: 'worktree_bootstrap',
        operation: 'direnv allow',
        error,
        context: { checkoutPath },
        cwd: repoRoot,
      });
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`direnv allow failed for ${checkoutPath}: ${detail}`);
    }
    console.log(
      `ℹ️  direnv not installed — worktree runs with your shell env (no flake devShell). ` +
        'Install tools manually or set up direnv + nix (`bun run setup`).',
    );
  }
};
