// scripts/src/lib/ops/__tests__/pre_commit.test.ts
//
// checkPlaintextSecrets() runs as a side effect of importing pre_commit.ts,
// so it can't be unit-tested in-process without also triggering the rest of
// the script. Spawn it as a subprocess against a deliberately-corrupted git
// repo instead — this exercises the "inspection itself failed" path (as
// opposed to "inspection ran and found violations"), which must fail closed
// (block the commit) rather than silently let it through.

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = import.meta.dir ? resolve(import.meta.dir, '../../../../..') : resolve('.');
const PRE_COMMIT_SCRIPT = join(REPO_ROOT, 'scripts/src/lib/ops/pre_commit.ts');

describe('pre_commit checkPlaintextSecrets', () => {
  it('fails closed (non-zero exit) when git inspection itself fails, not just when it finds violations', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'pre-commit-corrupt-'));
    try {
      const init = Bun.spawnSync({ cmd: ['git', 'init', '-q'], cwd: repoDir });
      expect(init.exitCode).toBe(0);

      // A truncated index makes `git diff --cached --name-only` fail while
      // `git rev-parse --show-toplevel` (used to resolve ROOT_DIR) still
      // succeeds — isolates the failure to the inspection step itself.
      writeFileSync(join(repoDir, '.git', 'index'), 'corrupt');

      const proc = Bun.spawnSync({
        cmd: ['bun', PRE_COMMIT_SCRIPT],
        cwd: repoDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(proc.exitCode).not.toBe(0);
      const stderr = proc.stderr.toString();
      expect(stderr).toContain('PRE-COMMIT BLOCKED');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }, 15000);
});
