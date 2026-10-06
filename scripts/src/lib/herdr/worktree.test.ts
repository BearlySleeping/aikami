// scripts/src/lib/herdr/worktree.test.ts
//
// The env-seed half of the worktree bootstrap post-conditions: a bootstrapped
// checkout is only usable if every gitignored-but-required file the root has is
// present in it, and the caller is told when one is not.
//
// The dependency-tree half lives in ./worktree_deps.test.ts, and repo identity
// in ./worktree_identity.test.ts.

import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCompleteWorktreeBootstrap,
  ENV_FILE_SUFFIXES,
  missingWorktreeSeeds,
  seedWorktreeFiles,
  WORKTREE_SEED_PATHS,
} from './worktree.ts';

describe('assertCompleteWorktreeBootstrap', () => {
  it('accepts an installed worktree with every seed', () => {
    expect(() =>
      assertCompleteWorktreeBootstrap({
        checkoutPath: '/worktree',
        bootstrap: { installed: true, missingSeeds: [] },
      }),
    ).not.toThrow();
  });

  it('rejects failed installs and missing seeds', () => {
    expect(() =>
      assertCompleteWorktreeBootstrap({
        checkoutPath: '/worktree',
        bootstrap: { installed: false, missingSeeds: ['.env'] },
      }),
    ).toThrow(/installed: false, missing seeds: \.env/);
  });
});

// ── Seed files ──────────────────────────────────────────────
//
// The C-526 remediation root cause: a manually created herdr worktree had no
// `client/.env.emulator`, so PUBLIC_MODE resolved to production and the
// `__AIKAMI_TEST__` seam was never installed — every /game E2E failed in
// bootIntoGame. The seed list and its post-condition check are what make that
// gap visible at bootstrap instead of in a failed run.

/** Root/worktree pair with two real client env files present in root. */
const makeSeedFixture = () => {
  const base = mkdtempSync(join(tmpdir(), 'aikami-worktree-seed-test-'));
  const repoRoot = join(base, 'root');
  const checkoutPath = join(base, 'worktree');
  mkdirSync(join(repoRoot, 'apps/frontend/client'), { recursive: true });
  mkdirSync(checkoutPath, { recursive: true });
  writeFileSync(join(repoRoot, 'apps/frontend/client/.env.emulator'), 'PUBLIC_MODE=emulator\n');
  writeFileSync(join(repoRoot, 'apps/frontend/client/.env.emulator.local'), 'LOCAL_OVERRIDE=1\n');
  return { base, repoRoot, checkoutPath };
};

describe('ENV_FILE_SUFFIXES', () => {
  it('covers the Vite mode-local override files', () => {
    expect(ENV_FILE_SUFFIXES).toContain('.env.emulator');
    expect(ENV_FILE_SUFFIXES).toContain('.env.emulator.local');
    expect(ENV_FILE_SUFFIXES).toContain('.env.staging.local');
    expect(ENV_FILE_SUFFIXES).toContain('.env.production.local');
  });

  it('seeds a mode-local override for every APP_CONFIG app plus the E2E lanes', () => {
    const seedPaths = WORKTREE_SEED_PATHS.map((entry) => entry.from);
    expect(seedPaths).toContain('apps/frontend/client/.env.emulator.local');
    expect(seedPaths).toContain('apps/frontend/hub/.env.emulator.local');
    expect(seedPaths).toContain('apps/frontend/site/.env.emulator');
    // The lanes that broke in the C-526 remediation run.
    expect(seedPaths).toContain('apps/e2e/.env');
    expect(seedPaths).toContain('scripts/.env');
  });
});

describe('seedWorktreeFiles', () => {
  it('copies the mode env files from root into the worktree', () => {
    const { base, repoRoot, checkoutPath } = makeSeedFixture();
    try {
      seedWorktreeFiles({ checkoutPath, repoRoot });
      const env = join(checkoutPath, 'apps/frontend/client/.env.emulator');
      const local = join(checkoutPath, 'apps/frontend/client/.env.emulator.local');
      expect(existsSync(env)).toBe(true);
      expect(readFileSync(env, 'utf-8')).toBe('PUBLIC_MODE=emulator\n');
      expect(existsSync(local)).toBe(true);
      expect(readFileSync(local, 'utf-8')).toBe('LOCAL_OVERRIDE=1\n');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports a failed directory copy even when a partial destination exists', () => {
    const { base, repoRoot, checkoutPath } = makeSeedFixture();
    const path = '.secrets';
    try {
      mkdirSync(join(repoRoot, path), { recursive: true });
      writeFileSync(join(repoRoot, path, 'service-account.json'), '{}');
      mkdirSync(join(checkoutPath, path, 'service-account.json'), { recursive: true });
      const failedSeeds = seedWorktreeFiles({ checkoutPath, repoRoot });
      expect(failedSeeds).toContain(path);
      expect(missingWorktreeSeeds({ checkoutPath, repoRoot, failedSeeds })).toContain(path);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('missingWorktreeSeeds', () => {
  it('reports a seed present in root but absent from the worktree', () => {
    const { base, repoRoot, checkoutPath } = makeSeedFixture();
    try {
      expect(missingWorktreeSeeds({ checkoutPath, repoRoot })).toContain(
        'apps/frontend/client/.env.emulator.local',
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports nothing once the seeds are copied', () => {
    const { base, repoRoot, checkoutPath } = makeSeedFixture();
    try {
      seedWorktreeFiles({ checkoutPath, repoRoot });
      expect(missingWorktreeSeeds({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('does not report seeds the root checkout does not have', () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-worktree-seed-test-'));
    const repoRoot = join(base, 'root');
    const checkoutPath = join(base, 'worktree');
    try {
      mkdirSync(repoRoot, { recursive: true });
      mkdirSync(checkoutPath, { recursive: true });
      expect(missingWorktreeSeeds({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
