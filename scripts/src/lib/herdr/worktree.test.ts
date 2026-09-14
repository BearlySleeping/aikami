// scripts/src/lib/herdr/worktree.test.ts
//
// Pins the worktree dependency-tree post-condition. Until C-476, the Windows
// node_modules seeding workaround in bootstrapWorktree ran on every platform:
// it builds a deliberately partial tree (`.bun`, `.bin`, `@aikami/*`) and never
// links ordinary top-level deps. Fresh POSIX worktrees therefore had no
// `@types/bun` or `@types/node`, `tsc` could not resolve `types: ["bun"]`, and
// pre-push validation died with TS2688 — after implementer AND verifier had
// both already passed, because nothing between bootstrap and push ever checked
// the tree was complete. missingWorktreeDeps is that check.

import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV_FILE_SUFFIXES,
  missingWorktreeDeps,
  missingWorktreeSeeds,
  seedWorktreeFiles,
  WORKTREE_SEED_PATHS,
} from './worktree.ts';

/** Build a root/worktree pair with the given top-level node_modules entries. */
const makeFixture = (rootEntries: string[], worktreeEntries: string[]) => {
  const base = mkdtempSync(join(tmpdir(), 'aikami-worktree-test-'));
  const repoRoot = join(base, 'root');
  const checkoutPath = join(base, 'worktree');
  for (const [dir, entries] of [
    [repoRoot, rootEntries],
    [checkoutPath, worktreeEntries],
  ] as const) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    for (const entry of entries) {
      mkdirSync(join(dir, 'node_modules', entry), { recursive: true });
    }
  }
  return { base, repoRoot, checkoutPath };
};

describe('missingWorktreeDeps', () => {
  it('flags the exact tree the Windows seeding path leaves on POSIX', () => {
    // The regression itself: seeding creates only .bun/.bin/@aikami, so every
    // real dependency is absent.
    const { base, repoRoot, checkoutPath } = makeFixture(
      ['.bun', '.bin', '@aikami', '@types', 'typescript', '@biomejs'],
      ['.bun', '.bin', '@aikami'],
    );
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot }).sort()).toEqual([
        '@biomejs',
        '@types',
        'typescript',
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports nothing for a completed bun install', () => {
    const { base, repoRoot, checkoutPath } = makeFixture(
      ['.bun', '@aikami', '@types', 'typescript'],
      ['.bun', '@aikami', '@types', 'typescript'],
    );
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('ignores @aikami — worktrees point it at their own source dirs', () => {
    const { base, repoRoot, checkoutPath } = makeFixture(['@aikami', 'typescript'], ['typescript']);
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('ignores dotted cache and shim dirs', () => {
    // .bun/.bin/.cache are caches and shims, not deps — a worktree that links
    // rather than copies them must not be reported as broken.
    const { base, repoRoot, checkoutPath } = makeFixture(
      ['.bun', '.bin', '.cache', 'typescript'],
      ['typescript'],
    );
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('ignores SvelteKit virtual roots ($app) that bun install never creates', () => {
    // The regression: root had generated `node_modules/$app` from a local
    // `svelte-kit sync`, so every fresh worktree warned "missing $app" even
    // though its dependency tree was complete.
    const { base, repoRoot, checkoutPath } = makeFixture(['$app', 'typescript'], ['typescript']);
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('counts a file entry as present', () => {
    // Root's node_modules holds files (.yarn-integrity, .modules.yaml) beside
    // package dirs; presence is what matters, not the node type.
    const { base, repoRoot, checkoutPath } = makeFixture(['typescript'], []);
    try {
      writeFileSync(join(checkoutPath, 'node_modules', 'typescript'), '');
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns empty when the root tree is absent rather than failing the run', () => {
    const { base, repoRoot, checkoutPath } = makeFixture([], []);
    try {
      rmSync(join(repoRoot, 'node_modules'), { recursive: true, force: true });
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
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
