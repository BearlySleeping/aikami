// scripts/src/lib/agents/git_worktree.test.ts
//
// Pins the command-string tokenizer behind runGit. runGit previously ran the
// command via `execSync` → cmd.exe on Windows, where POSIX single quotes are
// literal characters — `git status -- 'code.ts'` silently never matched the
// path. The tokenizer must reproduce the intended POSIX-shell argv for every
// quoting style the callers use, on every platform. The same file also pins
// C-560 base-ref normalization and comparison-range construction.

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapWorktreeContent,
  collectWorktreeContentFingerprintInput,
  computeWorktreeContentFingerprint,
  missingRequiredWorktreeContentOutputs,
  newGitStatusEntries,
  requiredWorktreeContentOutputPaths,
  WORKTREE_CONTENT_CACHE_RELATIVE_PATH,
  type WorktreeContentIO,
} from '../herdr/worktree_content.ts';
import type { BuildStep } from '../ops/emberwatch_build_steps.ts';
import { EMBERWATCH_BUILD_STEPS } from '../ops/emberwatch_build_steps.ts';
import {
  baseRefName,
  branchBaseRefName,
  buildRefRange,
  commitAll,
  normalizeBaseRef,
  resolveBaseRef,
  resolveRemoteBaseRef,
  splitGitCommand,
} from './git_worktree.ts';

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

describe('base ref normalization', () => {
  const sha = 'a'.repeat(40);

  it('prefers an existing local branch for a bare name', () => {
    const probes: string[] = [];
    const resolved = resolveBaseRef('main', {
      refExists: (ref) => {
        probes.push(ref);
        return true;
      },
    });

    expect(resolved).toBe('main');
    expect(probes).toEqual(['main']);
  });

  it('falls back to origin when the local branch is absent', () => {
    const probes: string[] = [];
    const resolved = resolveBaseRef('main', {
      refExists: (ref) => {
        probes.push(ref);
        return ref === 'origin/main';
      },
    });

    expect(resolved).toBe('origin/main');
    expect(probes).toEqual(['main', 'origin/main']);
  });

  it('keeps an explicit origin ref ahead of a local branch', () => {
    const probes: string[] = [];
    const resolved = resolveBaseRef('origin/main', {
      refExists: (ref) => {
        probes.push(ref);
        return true;
      },
    });

    expect(resolved).toBe('origin/main');
    expect(probes).toEqual(['origin/main']);
  });

  it('fails closed when neither local nor origin exists', () => {
    expect(() => resolveBaseRef('missing', { refExists: () => false })).toThrow(
      /Unable to resolve base ref/,
    );
  });

  it('strips local and remote namespace prefixes without duplicating origin', () => {
    expect(normalizeBaseRef('refs/heads/main')).toBe('main');
    expect(normalizeBaseRef('refs/remotes/origin/main')).toBe('origin/main');
    expect(normalizeBaseRef('origin/refs/heads/main')).toBe('origin/main');
    expect(normalizeBaseRef('origin/refs/remotes/origin/main')).toBe('origin/main');
    expect(baseRefName('origin/main')).toBe('main');
    expect(baseRefName('refs/remotes/origin/feature/base')).toBe('feature/base');
  });

  it('resolves a commit SHA as a commit rather than a branch name', () => {
    const probes: string[] = [];
    const resolved = resolveBaseRef(sha, {
      refExists: (ref) => {
        probes.push(ref);
        return ref === sha;
      },
    });

    expect(resolved).toBe(sha);
    expect(probes).toEqual([sha]);
  });

  it('uses real Git refs when no probe is injected', () => {
    const repository = mkdtempSync(join(tmpdir(), 'base-ref-git-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: repository });
      execFileSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd: repository });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
      writeFileSync(join(repository, 'tracked.txt'), 'initial\n');
      execFileSync('git', ['add', 'tracked.txt'], { cwd: repository });
      execFileSync('git', ['commit', '--no-verify', '-m', 'initial'], { cwd: repository });
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
        cwd: repository,
      });
      execFileSync('git', ['update-ref', 'refs/remotes/upstream/main', 'HEAD'], {
        cwd: repository,
      });
      execFileSync('git', ['update-ref', 'refs/heads/upstream/main', 'HEAD'], {
        cwd: repository,
      });

      expect(resolveBaseRef('main', { cwd: repository })).toBe('main');
      expect(resolveBaseRef('origin/main', { cwd: repository })).toBe('origin/main');
      expect(resolveBaseRef('refs/remotes/upstream/main', { cwd: repository })).toBe(
        'refs/remotes/upstream/main',
      );
      expect(resolveRemoteBaseRef('main', { cwd: repository })).toBe('origin/main');
      expect(resolveRemoteBaseRef('refs/remotes/upstream/main', { cwd: repository })).toBe(
        'refs/remotes/upstream/main',
      );
      expect(branchBaseRefName('refs/remotes/upstream/main')).toBe('main');
      expect(() => branchBaseRefName(commit)).toThrow(/branch refs/);
      expect(() => branchBaseRefName('HEAD')).toThrow(/branch refs/);
      expect(resolveBaseRef(commit, { cwd: repository })).toBe(commit);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it('rejects malformed, empty, and unsafe refs', () => {
    const invalid = [
      '',
      'main..dev',
      'main;rm -rf',
      'origin/',
      'origin/origin',
      'origin/origin/main',
      'refs/heads/',
      'refs/remotes/origin',
    ];
    for (const ref of invalid) {
      expect(() => normalizeBaseRef(ref)).toThrow(/Invalid base ref/);
    }
  });
});

describe('Git ref range helpers', () => {
  it('builds both rev-list and diff ranges without re-prefixing origin', () => {
    expect(buildRefRange({ base: 'origin/main', operator: '..' })).toBe('origin/main..HEAD');
    expect(buildRefRange({ base: 'refs/heads/main' })).toBe('main...HEAD');
  });

  it('keeps a normalized range as one command argument', () => {
    expect(splitGitCommand('diff --numstat origin/main...HEAD')).toEqual([
      'diff',
      '--numstat',
      'origin/main...HEAD',
    ]);
  });

  it('quotes unusual but valid ref characters for the command parser', () => {
    const range = buildRefRange({ base: "feature/o'neil" });
    expect(splitGitCommand(`diff --numstat ${range}`)).toEqual([
      'diff',
      '--numstat',
      "feature/o'neil...HEAD",
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

  it('keeps an untracked protected path out of the commit', () => {
    // Regression for a worktree branched before its contract reached `main`:
    // the contract copy is untracked, so `skip-worktree` cannot be applied and
    // `add -A` would otherwise sweep it onto the PR branch. The last-mile
    // protected-path guard must unstage it and leave the file on disk.
    const repository = mkdtempSync(join(tmpdir(), 'commit-all-protected-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd: repository });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
    writeFileSync(join(repository, 'code.ts'), 'export const a = 1;\n');
    execFileSync('git', ['add', 'code.ts'], { cwd: repository });
    execFileSync('git', ['commit', '--no-verify', '-m', 'init'], { cwd: repository });

    const contractRel = 'docs/contracts/C-999.md';
    mkdirSync(join(repository, 'docs/contracts'), { recursive: true });
    writeFileSync(join(repository, contractRel), 'contract\n');
    writeFileSync(join(repository, 'code.ts'), 'export const a = 2;\n');

    commitAll({ cwd: repository, message: 'impl', protectedPaths: [contractRel] });

    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    });
    expect(committed).toContain('code.ts');
    expect(committed).not.toContain(contractRel);
    expect(existsSync(join(repository, contractRel))).toBe(true);
  });
});

const contentManifest = JSON.stringify({
  atlas: { textureUrl: '/game-data/sprites/tilesets/atlas.webp' },
  maps: { village: {} },
  audio: { bindings: [{ source: { kind: 'asset', tag: 'music:exploration:village' } }] },
});

const makeContentIo = (
  statusAfter = '',
): {
  io: WorktreeContentIO;
  steps: BuildStep[];
  files: Map<string, string>;
} => {
  const files = new Map<string, string>();
  const steps: BuildStep[] = [];
  const statuses = ['', statusAfter];
  const io: WorktreeContentIO = {
    git: (args) => {
      const command = args.join(' ');
      if (command === 'rev-parse HEAD') {
        return 'revision-1\n';
      }
      if (command === 'diff --binary --no-ext-diff HEAD --') {
        return 'diff';
      }
      if (command === 'ls-files --others --exclude-standard -z') {
        return 'source.ts\0';
      }
      if (command.startsWith('status ')) {
        return statuses.shift() ?? '';
      }
      throw new Error(`Unexpected content git command: ${command}`);
    },
    runStep: (step) => steps.push(step),
    toolVersion: () => '1.4.0',
    exists: (path) =>
      path.endsWith('content/packs/emberwatch/manifest.json') ||
      files.has(path) ||
      !path.includes('/.local/'),
    readBytes: () => new Uint8Array([1, 2, 3]),
    readText: (path) =>
      path.endsWith('content/packs/emberwatch/manifest.json')
        ? contentManifest
        : (files.get(path) ?? ''),
    writeText: (path, text) => files.set(path, text),
    mkdir: () => {},
    now: () => 0,
  };
  return { io, steps, files };
};

describe('worktree content cache policy', () => {
  it('collects stable inputs and maps manifest audio to the generated path', () => {
    const { io } = makeContentIo();
    const input = collectWorktreeContentFingerprintInput({ checkoutPath: '/checkout', io });
    expect(input.revision).toBe('revision-1');
    expect(input.untrackedSources).toEqual([{ path: 'source.ts', digest: expect.any(String) }]);
    expect(
      requiredWorktreeContentOutputPaths({
        checkoutPath: '/checkout',
        io,
        manifestText: contentManifest,
      }),
    ).toContain('apps/frontend/client/static/game-data/music/exploration/village.webm');
    expect(
      missingRequiredWorktreeContentOutputs({
        checkoutPath: '/checkout',
        io,
        manifestText: contentManifest,
      }),
    ).toEqual([]);
  });

  it('runs the canonical steps once, writes a marker, and then hits cache', async () => {
    const { io, steps, files } = makeContentIo();
    const first = await bootstrapWorktreeContent({ checkoutPath: '/checkout', io });
    expect(first.cacheHit).toBe(false);
    expect(first.steps).toEqual(EMBERWATCH_BUILD_STEPS.map((step) => step.label));
    expect(steps).toEqual([...EMBERWATCH_BUILD_STEPS]);
    expect(files.has(join('/checkout', WORKTREE_CONTENT_CACHE_RELATIVE_PATH))).toBe(true);

    const second = await bootstrapWorktreeContent({ checkoutPath: '/checkout', io });
    expect(second.cacheHit).toBe(true);
    expect(steps).toHaveLength(EMBERWATCH_BUILD_STEPS.length);
  });

  it('fails closed when generation introduces a new Git status entry', async () => {
    const { io, files } = makeContentIo('?? generated.json\n');
    await expect(bootstrapWorktreeContent({ checkoutPath: '/checkout', io })).rejects.toThrow(
      /introduced new Git status entries/,
    );
    expect(files.has(join('/checkout', WORKTREE_CONTENT_CACHE_RELATIVE_PATH))).toBe(false);
  });

  it('rejects changes to an existing fingerprint input before writing a marker', async () => {
    const { io, files } = makeContentIo();
    io.runStep = () => {
      io.readBytes = () => new Uint8Array([4, 5, 6]);
    };
    await expect(bootstrapWorktreeContent({ checkoutPath: '/checkout', io })).rejects.toThrow(
      /changed pre-existing fingerprint inputs/,
    );
    expect(files.has(join('/checkout', WORKTREE_CONTENT_CACHE_RELATIVE_PATH))).toBe(false);
  });

  it('changes the fingerprint when a content input changes', () => {
    const { io } = makeContentIo();
    const input = collectWorktreeContentFingerprintInput({ checkoutPath: '/checkout', io });
    const base = computeWorktreeContentFingerprint(input);
    expect(computeWorktreeContentFingerprint({ ...input, dirtyDiff: 'changed' })).not.toBe(base);
    expect(newGitStatusEntries({ before: ' M a\n', after: ' M a\n?? b\n' })).toEqual(['?? b']);
  });
});
