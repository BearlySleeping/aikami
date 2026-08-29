// scripts/src/lib/herdr/seed_worktree_deps.ts
//
// Seed a worktree checkout with node_modules dependencies.
// Workaround for bun 1.4.0 on Windows: workspace packages with `/` in their
// names (e.g. `@aikami/frontend/engine`) fail with "is not a valid install
// folder name" on fresh installs.
//
// Strategy: let bun install fail on workspace packages, then create @aikami
// symlinks pointing to the worktree's own workspace source directories and
// retry. bun's .bun cache already has all non-workspace deps cached.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

export const seedWorktreeDeps = (options: { checkoutPath: string; repoRoot: string }): boolean => {
  const { checkoutPath, repoRoot } = options;
  const worktreeNodeModules = join(checkoutPath, 'node_modules');
  const aikamiDir = join(worktreeNodeModules, '@aikami');

  // Always create @aikami symlinks — bun's failed install may have left
  // an empty @aikami directory that we need to overwrite
  if (existsSync(aikamiDir)) {
    // Remove the empty directory bun left behind
    rmSync(aikamiDir, { recursive: true, force: true });
  }

  // Create @aikami symlinks pointing to worktree's own workspace source dirs
  mkdirSync(aikamiDir, { recursive: true });

  const workspaces =
    (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as { workspaces?: string[] })
      .workspaces ?? [];
  for (const wsGlob of workspaces) {
    const base = wsGlob.replace(/\*$/, '');
    const dir = join(checkoutPath, base);
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir)) {
      const pkgPath = join(dir, entry, 'package.json');
      if (!existsSync(pkgPath)) {
        continue;
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (!pkg.name?.startsWith('@aikami/')) {
        continue;
      }
      const parts = pkg.name.slice('@aikami/'.length).split('/');
      const targetDir = join(aikamiDir, ...parts);
      const srcDir = join(dir, entry);
      mkdirSync(join(targetDir, '..'), { recursive: true });
      try {
        symlinkSync(srcDir, targetDir, 'junction');
      } catch (err: unknown) {
        console.warn(
          `⚠️  Could not link ${pkg.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return false; // Let caller run bun install
};
