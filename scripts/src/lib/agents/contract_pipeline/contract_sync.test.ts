// scripts/src/lib/agents/contract_pipeline/contract_sync.test.ts
//
// Regression coverage for the contract-ownership invariant: the contract file
// lives on main and must NEVER enter a PR branch diff.
//
// The bug these tests pin (original): contract isolation used to be gated on
// `stage === 'critique'`, so `--source path` runs (hand-authored contracts,
// which skip both authoring stages) never got isolated. The implementer's
// Execution Report was committed to the PR branch and the root checkout was
// left dirty, so the user's next `git pull` aborted with a conflict.
//
// The bug these tests pin (2026-08-13): committing to main used to run
// `git add`/`git commit` against the root checkout's REAL working tree and
// index, refusing (and leaving a dirty file behind) whenever repoRoot wasn't
// on `main` — e.g. a human checking out a branch there for unrelated work
// while a pipeline's background sync fires. Observed twice in one session:
// a review-captain's PR-link write and an implementer's Execution Report both
// landed as dirty files on a feature branch instead of on main. Committing
// via plumbing against a throwaway index (see `commitContentToMain` in
// contract_sync.ts) fixes this: the commit no longer depends on — and cannot
// disturb — whatever branch repoRoot has checked out.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commitContractContent,
  commitContractToMain,
  currentBranch,
  hasUncommittedChanges,
  isolateContractInWorktree,
  pullContractFromWorktree,
  toGitPath,
} from './contract_sync.ts';

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
const CONTRACT_BODY = ['---', 'id: C-999', 'status: draft', '---', '', '# Contract C-999', ''].join(
  '\n',
);

let root: string;
let worktree: string;
let remote: string;
let contractPath: string;

beforeEach(() => {
  // A real bare remote so the push path is genuinely exercised — without one,
  // `push origin main` fails and the commit/push split below is untested.
  remote = mkdtempSync(join(tmpdir(), 'contract-sync-remote-'));
  git(['init', '--bare', '-b', 'main'], remote);

  root = mkdtempSync(join(tmpdir(), 'contract-sync-root-'));
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 'test@test.invalid'], root);
  git(['config', 'user.name', 'Test'], root);
  git(['config', 'commit.gpgsign', 'false'], root);

  contractPath = join(root, CONTRACT_REL);
  mkdirSync(join(root, 'docs/contracts'), { recursive: true });
  writeFileSync(contractPath, CONTRACT_BODY);
  writeFileSync(join(root, 'code.ts'), 'export const a = 1;\n');
  git(['add', '-A'], root);
  git(['commit', '-m', 'init'], root);
  git(['remote', 'add', 'origin', remote], root);
  git(['push', '-u', 'origin', 'main'], root);

  worktree = join(root, '..', `wt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  git(['worktree', 'add', '-b', 'contract-task-c-999', worktree], root);
});

afterEach(() => {
  for (const path of [worktree, root, remote]) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // best effort — temp dirs
    }
  }
});

describe('toGitPath (gitRelPath separator normalization)', () => {
  it('converts Windows backslash separators for git', () => {
    expect(toGitPath(String.raw`docs\contracts\C-400-test.md`, '\\')).toBe(
      'docs/contracts/C-400-test.md',
    );
  });

  it('preserves literal backslashes in POSIX filenames', () => {
    // On POSIX `path.sep` is '/', so a repo-relative filename containing a
    // literal `\` must pass through unchanged — git treats `\` as a plain
    // character in POSIX paths, and the old blanket `split('\\')` mangled it.
    expect(toGitPath(String.raw`docs\contracts\C-400-test.md`, '/')).toBe(
      String.raw`docs\contracts\C-400-test.md`,
    );
  });

  it('is a no-op on already-forward-slash paths on any platform', () => {
    expect(toGitPath('docs/contracts/C-400-test.md')).toBe('docs/contracts/C-400-test.md');
  });
});

describe('currentBranch', () => {
  it('reports the checked-out branch', () => {
    expect(currentBranch(root)).toBe('main');
    expect(currentBranch(worktree)).toBe('contract-task-c-999');
  });
});

describe('hasUncommittedChanges', () => {
  it('is scoped to the given path', () => {
    writeFileSync(join(root, 'code.ts'), 'export const a = 2;\n');
    expect(hasUncommittedChanges({ cwd: root, path: 'code.ts' })).toBe(true);
    // An unrelated dirty file must not report the contract as dirty.
    expect(hasUncommittedChanges({ cwd: root, path: CONTRACT_REL })).toBe(false);
  });
});

describe('isolateContractInWorktree', () => {
  it('keeps an agent edit out of the branch diff', () => {
    const isolated = isolateContractInWorktree({
      repoRoot: root,
      worktreePath: worktree,
      contractPath,
    });
    expect(isolated.ok).toBe(true);

    // Simulate the implementer appending its Execution Report.
    const worktreeCopy = join(worktree, CONTRACT_REL);
    writeFileSync(worktreeCopy, `${CONTRACT_BODY}\n## Execution Report\nDone.\n`);

    // 🔴 The regression: without skip-worktree this shows as modified and
    // `commitAll`'s `add -A` sweeps it into the PR branch.
    expect(hasUncommittedChanges({ cwd: worktree, path: CONTRACT_REL })).toBe(false);

    // A real code change in the same worktree must still be committable.
    writeFileSync(join(worktree, 'code.ts'), 'export const a = 3;\n');
    git(['add', '-A'], worktree);
    git(['commit', '-m', 'impl'], worktree);

    const changed = git(['show', '--name-only', '--format=', 'HEAD'], worktree);
    expect(changed).toContain('code.ts');
    expect(changed).not.toContain('C-999-test.md');
  });

  it('is idempotent across repeated stages', () => {
    for (let i = 0; i < 3; i++) {
      expect(
        isolateContractInWorktree({ repoRoot: root, worktreePath: worktree, contractPath }).ok,
      ).toBe(true);
    }
    expect(hasUncommittedChanges({ cwd: worktree, path: CONTRACT_REL })).toBe(false);
  });

  it('seeds the worktree with the root contract content', () => {
    writeFileSync(contractPath, `${CONTRACT_BODY}\n| **Status** | approved |\n`);
    isolateContractInWorktree({ repoRoot: root, worktreePath: worktree, contractPath });
    expect(readFileSync(join(worktree, CONTRACT_REL), 'utf-8')).toContain('approved');
  });

  it('no-ops without a worktree', () => {
    const result = isolateContractInWorktree({
      repoRoot: root,
      worktreePath: undefined,
      contractPath,
    });
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
  });
});

describe('commitContractToMain', () => {
  it('commits a changed contract and leaves the tree clean', () => {
    writeFileSync(contractPath, `${CONTRACT_BODY}\nEdited.\n`);
    const result = commitContractToMain({ repoRoot: root, contractPath, message: 'docs: edit' });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    // 🔴 The user-visible symptom: a dirty root aborts `git pull --ff-only`.
    expect(hasUncommittedChanges({ cwd: root, path: CONTRACT_REL })).toBe(false);
  });

  it('does not create an empty commit when nothing changed', () => {
    const before = git(['rev-parse', 'HEAD'], root);
    const result = commitContractToMain({ repoRoot: root, contractPath, message: 'docs: noop' });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
    expect(git(['rev-parse', 'HEAD'], root)).toBe(before);
  });

  it('reports a clean tree even when the push fails', () => {
    // The tree being clean is what unblocks `git pull --ff-only`; an unpushed
    // commit is a follow-up, not a broken state.
    git(['remote', 'set-url', 'origin', join(tmpdir(), 'definitely-not-a-repo')], root);
    writeFileSync(contractPath, `${CONTRACT_BODY}\nEdited.\n`);

    const result = commitContractToMain({ repoRoot: root, contractPath, message: 'docs: edit' });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.message).toContain('push failed');
    expect(result.message).not.toContain('git commit -m');
    expect(hasUncommittedChanges({ cwd: root, path: CONTRACT_REL })).toBe(false);
  });

  it('commits to main even when repoRoot is checked out on an unrelated branch', () => {
    // 🔴 The 2026-08-13 regression, reproduced directly: repoRoot sits on a
    // branch that has nothing to do with the contract (e.g. a human's own
    // feature work) while this runs.
    git(['checkout', '-b', 'feat/unrelated'], root);
    writeFileSync(join(root, 'code.ts'), 'export const a = 42;\n');
    git(['add', '-A'], root);
    git(['commit', '-m', 'unrelated work'], root);
    writeFileSync(contractPath, `${CONTRACT_BODY}\nEdited off main.\n`);

    const result = commitContractToMain({
      repoRoot: root,
      contractPath,
      message: 'docs: edit from elsewhere',
    });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    // Still on the same branch — this never switches the human's checkout.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root)).toBe('feat/unrelated');

    // origin/main has the edit, fetched fresh.
    git(['fetch', 'origin', 'main'], root);
    expect(git(['show', `origin/main:${CONTRACT_REL}`], root)).toContain('Edited off main.');
  });
});

describe('commitContractContent', () => {
  it('commits explicit content to main without ever writing contractPath on disk', () => {
    // This is what the critique-approval step now uses instead of
    // "write contractPath, then commitContractToMain" — the exact shape of
    // the second 2026-08-13 regression (updateContractStatus's raw write
    // landing on whatever branch repoRoot happened to have checked out).
    git(['checkout', '-b', 'feat/unrelated'], root);
    const onDiskBefore = readFileSync(contractPath, 'utf-8');

    const result = commitContractContent({
      repoRoot: root,
      contractPath,
      content: `${CONTRACT_BODY}\n| **Status** | approved |\n`,
      message: 'docs(contracts): approve C-999',
    });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    // The working tree on the unrelated branch is byte-for-byte untouched.
    expect(readFileSync(contractPath, 'utf-8')).toBe(onDiskBefore);
    expect(hasUncommittedChanges({ cwd: root, path: CONTRACT_REL })).toBe(false);

    git(['fetch', 'origin', 'main'], root);
    expect(git(['show', `origin/main:${CONTRACT_REL}`], root)).toContain('approved');
  });

  it('refreshes the working copy when repoRoot is on main', () => {
    const result = commitContractContent({
      repoRoot: root,
      contractPath,
      content: `${CONTRACT_BODY}\n| **Status** | approved |\n`,
      message: 'docs(contracts): approve C-999',
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(contractPath, 'utf-8')).toContain('approved');
    expect(hasUncommittedChanges({ cwd: root, path: CONTRACT_REL })).toBe(false);
  });
});

describe('pullContractFromWorktree', () => {
  it('carries an agent edit back to main and refreshes root (which is on main)', () => {
    isolateContractInWorktree({ repoRoot: root, worktreePath: worktree, contractPath });
    writeFileSync(
      join(worktree, CONTRACT_REL),
      `${CONTRACT_BODY}\n## Execution Report\nAll ACs verified.\n`,
    );

    const result = pullContractFromWorktree({
      repoRoot: root,
      worktreePath: worktree,
      contractPath,
      contractId: 'C-999',
      stage: 'implement',
    });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(readFileSync(contractPath, 'utf-8')).toContain('All ACs verified.');
    expect(hasUncommittedChanges({ cwd: root, path: CONTRACT_REL })).toBe(false);
    expect(git(['show', '--name-only', '--format=', 'HEAD'], root)).toContain('C-999-test.md');
  });

  it('does not commit when the stage left the contract untouched', () => {
    isolateContractInWorktree({ repoRoot: root, worktreePath: worktree, contractPath });
    const before = git(['rev-parse', 'HEAD'], root);

    const result = pullContractFromWorktree({
      repoRoot: root,
      worktreePath: worktree,
      contractPath,
      contractId: 'C-999',
      stage: 'verify',
    });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
    expect(git(['rev-parse', 'HEAD'], root)).toBe(before);
  });

  it('no-ops when the worktree has no contract copy', () => {
    const missing = join(root, 'docs/contracts/C-000-absent.md');
    const result = pullContractFromWorktree({
      repoRoot: root,
      worktreePath: worktree,
      contractPath: missing,
      contractId: 'C-000',
      stage: 'implement',
    });
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
  });

  it('lands the edit on main without dirtying repoRoot when it is on an unrelated branch', () => {
    // 🔴 The exact production incident: an implementer/verifier/review-
    // captain's edit, carried back from the worktree, while a human has
    // repoRoot checked out on their own branch for unrelated work.
    isolateContractInWorktree({ repoRoot: root, worktreePath: worktree, contractPath });
    writeFileSync(
      join(worktree, CONTRACT_REL),
      `${CONTRACT_BODY}\n## Execution Report\nShipped while root was elsewhere.\n`,
    );

    git(['checkout', '-b', 'feat/unrelated'], root);
    writeFileSync(join(root, 'code.ts'), 'export const a = 7;\n');
    git(['add', '-A'], root);
    git(['commit', '-m', 'unrelated work'], root);
    const cleanBefore = git(['status', '--porcelain'], root);
    expect(cleanBefore).toBe('');

    const result = pullContractFromWorktree({
      repoRoot: root,
      worktreePath: worktree,
      contractPath,
      contractId: 'C-999',
      stage: 'implement',
    });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);

    // repoRoot is untouched: still on its own branch, still clean, still
    // showing its own unrelated commit's content for the contract file (not
    // the implementer's edit — that only exists on main now).
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root)).toBe('feat/unrelated');
    expect(git(['status', '--porcelain'], root)).toBe('');
    expect(readFileSync(contractPath, 'utf-8')).not.toContain('Shipped while root was elsewhere.');

    // But main has it.
    git(['fetch', 'origin', 'main'], root);
    expect(git(['show', `origin/main:${CONTRACT_REL}`], root)).toContain(
      'Shipped while root was elsewhere.',
    );
  });
});

describe('concurrent writers racing the same push', () => {
  it('retries on a non-fast-forward rejection and lands both edits', () => {
    // Simulate a second pipeline pushing to main between this call's read
    // and its push, by pre-pushing a commit from an independent clone right
    // before calling commitContractToMain — the retry loop must refetch and
    // rebuild rather than fail outright.
    const otherClone = mkdtempSync(join(tmpdir(), 'contract-sync-other-'));
    git(['clone', remote, otherClone], root);
    git(['config', 'user.email', 'other@test.invalid'], otherClone);
    git(['config', 'user.name', 'Other'], otherClone);
    git(['config', 'commit.gpgsign', 'false'], otherClone);
    writeFileSync(join(otherClone, 'code.ts'), 'export const a = 999;\n');
    git(['add', '-A'], otherClone);
    git(['commit', '-m', 'other pipeline commit'], otherClone);
    git(['push', 'origin', 'main'], otherClone);
    rmSync(otherClone, { recursive: true, force: true });

    // root's local `main` is now stale relative to origin — exactly the
    // state a long-running pipeline process would be in.
    writeFileSync(contractPath, `${CONTRACT_BODY}\nRaced edit.\n`);
    const result = commitContractToMain({ repoRoot: root, contractPath, message: 'docs: raced' });

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);

    git(['fetch', 'origin', 'main'], root);
    // Both the other pipeline's commit and this one survive on main.
    const log = git(['log', '--oneline', 'origin/main'], root);
    expect(log).toContain('other pipeline commit');
    expect(git(['show', `origin/main:${CONTRACT_REL}`], root)).toContain('Raced edit.');
  });
});

describe('end-to-end: a path-sourced run leaves no conflict', () => {
  it('PR branch carries code only; contract changes land on main', () => {
    // The exact shape of a `bun run contract C-999` run: no critique stage.
    isolateContractInWorktree({ repoRoot: root, worktreePath: worktree, contractPath });

    // Implementer: code change + Execution Report append.
    writeFileSync(join(worktree, 'code.ts'), 'export const a = 42;\n');
    writeFileSync(
      join(worktree, CONTRACT_REL),
      `${CONTRACT_BODY}\n## Execution Report\nShipped.\n`,
    );
    git(['add', '-A'], worktree);
    git(['commit', '-m', 'Feat: implementation'], worktree);

    pullContractFromWorktree({
      repoRoot: root,
      worktreePath: worktree,
      contractPath,
      contractId: 'C-999',
      stage: 'implement',
    });

    // The PR branch must not touch the contract at all.
    const branchFiles = git(['diff', '--name-only', 'main...contract-task-c-999'], root);
    expect(branchFiles).toContain('code.ts');
    expect(branchFiles).not.toContain('C-999-test.md');

    // And the root is clean, so `git pull --ff-only` cannot abort.
    expect(git(['status', '--porcelain'], root)).toBe('');
  });
});
