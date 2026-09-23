// scripts/src/lib/agents/contract_pipeline/git_state.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentCommit, isCleanWorktreeAtCommit } from './git_state.ts';

describe('isCleanWorktreeAtCommit', () => {
  let cwd: string;
  const contractPath = 'docs/contracts/C-999-test.md';

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'git-state-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd });
    execFileSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
    mkdirSync(join(cwd, 'docs', 'contracts'), { recursive: true });
    writeFileSync(join(cwd, contractPath), 'initial contract\n');
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('requires the saved HEAD and a clean tree after excluding the contract', () => {
    const startCommit = currentCommit(cwd);
    const options = { cwd, commit: startCommit, excludePaths: [contractPath] };

    expect(isCleanWorktreeAtCommit(options)).toBe(true);

    writeFileSync(join(cwd, contractPath), 'isolated contract update\n');
    expect(isCleanWorktreeAtCommit(options)).toBe(true);

    writeFileSync(join(cwd, 'implementation.ts'), 'export {};\n');
    expect(isCleanWorktreeAtCommit(options)).toBe(false);

    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-m', 'implementation'], { cwd });
    expect(isCleanWorktreeAtCommit(options)).toBe(false);
    expect(isCleanWorktreeAtCommit({ cwd, excludePaths: [contractPath] })).toBe(false);
  });
});
