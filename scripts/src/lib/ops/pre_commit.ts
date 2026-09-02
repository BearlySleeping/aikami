#!/usr/bin/env bun
// scripts/src/lib/ops/pre_commit.ts
//
// Centralized pre-commit hook. Run from .moon/workspace.yml via `bun run pre-commit`.
// In a linked git worktree (contract pipeline), skips knowledge:sync.
// Formatting and typechecking always run, everywhere.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runStream } from '../cli_utils.ts';
import { isOutsideAgentWorkspace } from './guard_workspace_boundary.ts';
import { isSopsEncrypted } from './secrets_backend.ts';
import { syncContracts } from './sync_contracts.ts';

/**
 * True in any linked git worktree — the contract pipeline's or a developer's.
 *
 * 🔴 This must NOT rely on CONTRACT_PIPELINE_WORKTREE alone. That variable is
 * exported by `commitAll` (git_worktree.ts) for the orchestrator's own
 * sweep-up commit, which passes `--no-verify` and therefore never reaches
 * this file. The commits that DO run this hook inside a worktree are the ones
 * the implementer agent makes itself — and those carry no such variable.
 *
 * Getting this wrong is not cosmetic. With `isWorktree` false in a worktree,
 * the knowledge:sync block below runs `syncContracts()` and then
 * `git add docs/contracts/`, staging the contract file into the agent's
 * commit. The contract is deliberately skip-worktree'd and owned by `main`
 * (see isolateContractInWorktree / pullContractFromWorktree) precisely so it
 * never rides along in a PR diff and never conflicts on `git pull` after a
 * merge.
 *
 * `--git-dir` differs from `--git-common-dir` only in a linked worktree, so
 * this detects the condition itself rather than trusting the caller.
 */
const inLinkedWorktree = (): boolean => {
  try {
    const gitDir = execSync('git rev-parse --absolute-git-dir', { encoding: 'utf8' }).trim();
    const commonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      encoding: 'utf8',
    }).trim();
    return gitDir !== commonDir;
  } catch {
    // Cannot tell — assume worktree, i.e. take the conservative branch that
    // does NOT mutate shared dashboard files.
    return true;
  }
};

const isWorktree = !!process.env.CONTRACT_PIPELINE_WORKTREE || inLinkedWorktree();

// ── Plaintext secret guard (AC-5) ─────────────────────────────────────
// Reject commits that contain unencrypted .env.production / .env.staging
// or secrets/*.enc.env files that are not actually encrypted.

const ROOT_DIR = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

const PLAINTEXT_PATTERNS = ['.env.production', '.env.staging'];

export function checkPlaintextSecrets(): void {
  try {
    // Get staged files
    const staged = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      cwd: ROOT_DIR,
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    const violations: string[] = [];

    for (const file of staged) {
      // Check 1: plaintext env files for production/staging
      for (const pattern of PLAINTEXT_PATTERNS) {
        if (file.endsWith(pattern)) {
          violations.push(
            `🔴 Plaintext secret file staged: ${file}\n` +
              `   Unencrypted .env.production/.env.staging must NEVER be committed.\n` +
              `   Use 'sops --encrypt secrets/${pattern.replace('.env.', '')}.enc.env' instead.`,
          );
        }
      }

      // Check 2: secrets/*.enc.env that are not actually encrypted
      if (file.startsWith('secrets/') && file.endsWith('.enc.env')) {
        const fullPath = join(ROOT_DIR, file);
        if (existsSync(fullPath) && !isSopsEncrypted(fullPath)) {
          violations.push(
            `🔴 File ${file} appears to be a plaintext env file at an encrypted path.\n` +
              `   This means 'sops --encrypt' failed or was skipped.\n` +
              `   Re-encrypt with: sops --encrypt ${file}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      console.error('\n❌ PRE-COMMIT BLOCKED: Plaintext secrets detected\n');
      for (const v of violations) {
        console.error(v);
        console.error('');
      }
      process.exit(1);
    }
  } catch (err) {
    // 🔴 Fail closed. This guard exists to catch a real security mistake
    // (plaintext secrets staged for commit) — an inspection failure (git
    // command error, unreadable file) must block the commit too, not pass
    // it through silently. ROOT_DIR above already resolves the repo root
    // unguarded, so "not a git repo" can't reach this catch — anything
    // landing here is a genuine, unexpected failure.
    console.error('\n❌ PRE-COMMIT BLOCKED: could not inspect staged files for plaintext secrets');
    console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// 🔴 Boundary guard FIRST — before any expensive step. If a pipeline agent is
// committing into a repository that is not its own worktree, nothing else
// about this commit matters. See guard_workspace_boundary.ts.
if (
  isOutsideAgentWorkspace({
    workspacePath: process.env.CONTRACT_PIPELINE_WORKSPACE_PATH,
    role: process.env.CONTRACT_PIPELINE_ROLE,
    repositoryRoot: ROOT_DIR,
  })
) {
  execSync('bun run scripts/src/lib/ops/guard_workspace_boundary.ts', { stdio: 'inherit' });
  process.exit(1);
}

checkPlaintextSecrets();

/**
 * `git add` a path list, tolerating paths that no longer exist.
 *
 * execFileSync with an argv array rather than a shell string: paths reach git
 * verbatim, so a filename containing a space or a quote cannot split into two
 * arguments or escape into the command line.
 */
const stage = (paths: string[]): void => {
  if (paths.length === 0) {
    return;
  }
  try {
    execFileSync('git', ['add', '--', ...paths], {
      cwd: ROOT_DIR,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // Best-effort: a path a formatter deleted, or nothing left to add.
  }
};

const sh = async (cmd: string): Promise<void> => {
  const parts = cmd.split(' ').filter(Boolean);
  const code = await runStream(parts);
  if (code !== 0) {
    console.error(`❌ Pre-commit step failed (exit ${code}): ${cmd}`);
    process.exit(1);
  }
};

// 1. Bun version must be declared identically in .bun-version and
//    .moon/toolchains.yml — a drift silently breaks CI cache keys.
await sh('bun run scripts/src/lib/ops/verify_bun_version.ts');

// 2. Fix formatting + lint on affected staged files
await sh('bun moon run :fix --affected --status=staged --concurrency 8');

// 3. Typecheck affected projects
await sh('bun moon run :typecheck --affected --status=staged --concurrency 8');

if (!isWorktree) {
  // 4. Sync contract dashboard files (PROGRESS.md, PROMOTION.md)
  syncContracts();

  // 5. Generate .context/llms.txt
  await sh('bun run scripts/src/lib/ops/generate_llms_txt.ts');

  // 6. Stage files modified by sync
  stage(['.context/llms.txt', 'docs/contracts/']);
}

// 7. Re-stage files that formatters may have modified in place.
// 🔴 Read the staged list into the process and re-add it here rather than
// piping `git diff | xargs git add` through `sh -c`: there is no `sh` on a
// stock Windows machine, so that spelling failed silently and left Biome's
// reformatting out of the commit for Windows contributors.
try {
  const staged = execSync('git diff -z --name-only --cached', {
    encoding: 'utf8',
    cwd: ROOT_DIR,
  })
    .split('\0')
    .filter(Boolean);
  stage(staged);
} catch {
  // Nothing staged, or git unavailable — neither is worth blocking a commit.
}
