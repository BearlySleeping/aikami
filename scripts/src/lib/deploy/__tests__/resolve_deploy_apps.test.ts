// scripts/src/lib/deploy/__tests__/resolve_deploy_apps.test.ts
//
// resolve_deploy_apps.ts runs its main() as a side effect of import, so it is
// exercised as a subprocess (same pattern as resolve_plan.test.ts). This pins
// the force-push guard: when the push's `before` SHA is unreachable (e.g. an
// amend + force-push orphaned it), the script must NOT hand moon a bad object
// and instead conservatively deploy every push-deployable app with force=true.

import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../resolve_deploy_apps.ts');

/** A throwaway git repo with a single "test commit" (no deploy[...] override). */
const fixtureRepo = (): string => {
  const repoDir = mkdtempSync(join(tmpdir(), 'aikami-resolve-apps-'));
  execSync('git init -q', { cwd: repoDir });
  execSync('git config user.email test@example.com', { cwd: repoDir });
  execSync('git config user.name Test', { cwd: repoDir });
  writeFileSync(join(repoDir, 'README.md'), 'x');
  execSync('git add .', { cwd: repoDir });
  execSync('git commit -qm "test commit"', { cwd: repoDir });
  return repoDir;
};

describe('resolve_deploy_apps orphaned before SHA (force-push guard)', () => {
  test('an unreachable before SHA deploys all push-deployable apps with force=true', () => {
    const repoDir = fixtureRepo();
    try {
      const envPath = join(repoDir, 'github-env.txt');
      const outputPath = join(repoDir, 'github-output.txt');
      const head = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

      // All-zeros is the first-push case; this non-zero, unreachable SHA is
      // the force-push case — `git cat-file -e` must fail for it, so the guard
      // short-circuits before ever calling `moon query projects --affected`.
      const orphanedBase = 'f'.repeat(40);

      const proc = Bun.spawnSync(
        [process.execPath, SCRIPT, '--event=push', `--base=${orphanedBase}`, `--head=${head}`],
        {
          cwd: repoDir,
          env: { ...process.env, GITHUB_ENV: envPath, GITHUB_OUTPUT: outputPath },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );

      expect(proc.exitCode).toBe(0);
      expect(readFileSync(outputPath, 'utf8')).toContain('force=true\n');

      const deployApps = readFileSync(envPath, 'utf8');
      // client-tauri is never an automatic side effect of a web push.
      expect(deployApps).toContain('DEPLOY_APPS=client');
      expect(deployApps).not.toContain('client-tauri');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }, 15000);
});
