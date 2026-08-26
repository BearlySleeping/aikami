// scripts/src/lib/agents/contract_pipeline/orchestrator_precondition.test.ts
//
// Covers checkImplementPrecondition()'s fast-fail: a `draft` contract must be
// caught in milliseconds, before a worker is ever spawned, and it must be
// caught off `main`'s committed content — not repoRoot's on-disk mirror,
// which can lag behind it. See the C-443 incident note on the function.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitContractToMain } from './contract_sync.ts';
import { checkImplementPrecondition } from './orchestrator.ts';

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.invalid',
    },
  }).trim();

const CONTRACT_REL = 'docs/contracts/C-999-test.md';
const draftBody = [
  '---',
  'id: C-999',
  'status: draft',
  '---',
  '',
  '| **Status** | draft |',
  '',
].join('\n');
const approvedBody = draftBody.replaceAll('draft', 'approved');

let root: string;
let remote: string;
let contractPath: string;

beforeEach(() => {
  remote = mkdtempSync(join(tmpdir(), 'precondition-remote-'));
  git(['init', '--bare', '-b', 'main'], remote);

  root = mkdtempSync(join(tmpdir(), 'precondition-root-'));
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 'test@test.invalid'], root);
  git(['config', 'user.name', 'Test'], root);
  git(['config', 'commit.gpgsign', 'false'], root);

  contractPath = join(root, CONTRACT_REL);
  mkdirSync(join(root, 'docs/contracts'), { recursive: true });
  writeFileSync(contractPath, draftBody);
  git(['add', '-A'], root);
  git(['commit', '-m', 'init'], root);
  git(['remote', 'add', 'origin', remote], root);
  git(['push', '-u', 'origin', 'main'], root);
});

afterEach(() => {
  for (const path of [root, remote]) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

describe('checkImplementPrecondition', () => {
  it('blocks without spawning a worker when main has status draft', () => {
    const result = checkImplementPrecondition({
      repoRoot: root,
      contractPath,
      runId: 'run-test-C-999',
      attempt: 1,
    });
    expect(result?.status).toBe('blocked');
    expect(result?.summary).toContain('draft');
  });

  it('proceeds (undefined) once main has status approved', () => {
    writeFileSync(contractPath, approvedBody);
    commitContractToMain({ repoRoot: root, contractPath, message: 'docs: approve' });

    const result = checkImplementPrecondition({
      repoRoot: root,
      contractPath,
      runId: 'run-test-C-999',
      attempt: 1,
    });
    expect(result).toBeUndefined();
  });

  it('reads main, not a stale on-disk mirror — the C-443 regression', () => {
    // approve on main, then desync ONLY repoRoot's disk copy back to draft —
    // exactly the gap `isolateContractInWorktree` used to be fooled by.
    writeFileSync(contractPath, approvedBody);
    commitContractToMain({ repoRoot: root, contractPath, message: 'docs: approve' });
    writeFileSync(contractPath, draftBody);

    const result = checkImplementPrecondition({
      repoRoot: root,
      contractPath,
      runId: 'run-test-C-999',
      attempt: 1,
    });
    // main says approved — must proceed, even though disk still says draft.
    expect(result).toBeUndefined();
  });

  it('proceeds when the contract is not on main yet', () => {
    const freshPath = join(root, 'docs/contracts/C-998-fresh.md');
    writeFileSync(freshPath, draftBody);

    const result = checkImplementPrecondition({
      repoRoot: root,
      contractPath: freshPath,
      runId: 'run-test-C-998',
      attempt: 1,
    });
    expect(result).toBeUndefined();
  });
});
