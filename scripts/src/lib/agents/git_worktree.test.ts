// scripts/src/lib/agents/git_worktree.test.ts
//
// Pins the command-string tokenizer behind runGit. runGit previously ran the
// command via `execSync` → cmd.exe on Windows, where POSIX single quotes are
// literal characters — `git status -- 'code.ts'` silently never matched the
// path. The tokenizer must reproduce the intended POSIX-shell argv for every
// quoting style the callers use, on every platform.

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, splitGitCommand } from './git_worktree.ts';

describe('splitGitCommand', () => {
  it('splits plain tokens on whitespace', () => {
    expect(splitGitCommand('status --porcelain --branch')).toEqual([
      'status',
      '--porcelain',
      '--branch',
    ]);
  });

  it('unquotes a single-quoted path', () => {
    expect(splitGitCommand("status --porcelain -- 'docs/contracts/C-999.md'")).toEqual([
      'status',
      '--porcelain',
      '--',
      'docs/contracts/C-999.md',
    ]);
  });

  it('keeps spaces inside single-quoted segments as one arg', () => {
    expect(splitGitCommand("worktree remove 'C:\\repo dir\\wt' --force")).toEqual([
      'worktree',
      'remove',
      'C:\\repo dir\\wt',
      '--force',
    ]);
  });

  it('honors the POSIX single-quote escape', () => {
    // worktree.ts quotes branch names with `'\''` — git refnames may contain
    // apostrophes: `branch -D 'a'\''b'` must tokenize to a single `a'b` arg.
    expect(splitGitCommand("branch -D 'a'\\''b'")).toEqual(['branch', '-D', "a'b"]);
  });

  it('unquotes double-quoted values and escaped quotes', () => {
    expect(splitGitCommand(`-c "user.name=Pi Agent" -c "user.email=x@y" add -A`)).toEqual([
      '-c',
      'user.name=Pi Agent',
      '-c',
      'user.email=x@y',
      'add',
      '-A',
    ]);
    // String.raw keeps the `\"` escapes literal so the tokenizer sees them.
    expect(splitGitCommand(String.raw`commit -m "he said \"hi\""`)).toEqual([
      'commit',
      '-m',
      'he said "hi"',
    ]);
  });

  it('keeps %-formats with spaces as one arg', () => {
    expect(splitGitCommand('log -1 --format="%H %s"')).toEqual(['log', '-1', '--format=%H %s']);
  });

  it('handles unquoted interpolated values', () => {
    expect(
      splitGitCommand('update-index --add --cacheinfo 100644,abc123,docs/contracts/C-999.md'),
    ).toEqual(['update-index', '--add', '--cacheinfo', '100644,abc123,docs/contracts/C-999.md']);
  });

  it('does not shell-expand $ or backticks', () => {
    expect(splitGitCommand('commit -m "$HOME `whoami`"')).toEqual([
      'commit',
      '-m',
      '$HOME `whoami`',
    ]);
  });
});

describe('commitAll', () => {
  it('runs configured hooks when hook verification is requested', () => {
    const repository = mkdtempSync(join(tmpdir(), 'commit-all-hooks-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd: repository });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
    writeFileSync(join(repository, 'tracked.txt'), 'initial\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repository });
    execFileSync('git', ['commit', '--no-verify', '-m', 'initial'], { cwd: repository });
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();

    const hooksDirectory = join(repository, '.githooks');
    mkdirSync(hooksDirectory);
    const hookPath = join(hooksDirectory, 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
    chmodSync(hookPath, 0o755);
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repository });
    writeFileSync(join(repository, 'tracked.txt'), 'changed\n');

    expect(() => commitAll({ cwd: repository, message: 'must fail', verifyHooks: true })).toThrow();
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    expect(headAfter).toBe(headBefore);
  });
});
