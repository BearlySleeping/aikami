// scripts/src/lib/herdr/worktree_seeds.ts
//
// Gitignored-but-required seed files for herdr worktrees.
//
// A raw `herdr worktree create` produces a git checkout with none of the
// gitignored environment files the dev servers / E2E lanes rely on, so a fresh
// worktree can't run `bun run dev:emulator`, `astro build`, or the visual
// runner until those files are copied from the root checkout. This module owns
// that list plus the checks that prove the copy actually happened.
//
// Extracted from worktree.ts (which is at its reviewed source-file-size
// exception ceiling) so the lifecycle module stays focused on
// create/open/removish/publish and this one on which files a worktree needs.

import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG } from '../deploy/deployment_config.ts';
import { AIKAMI_MODES } from '../env/mode';

export type WorktreeSeedEntry = {
  from: string;
  to: string;
  kind: 'file' | 'dir';
  optional?: boolean;
};

/**
 * Per-app env files a worktree may need. Missing ones are silently skipped
 * (optional: true below), so it's safe to list every suffix for every app
 * rather than tracking which app actually has which file on disk.
 *
 * 🔴 The list is derived from AIKAMI_MODES so the Vite mode-loading order is
 * covered completely: `.env.<mode>` AND the higher-precedence
 * `.env.<mode>.local` override. The old hardcoded list omitted
 * `.env.emulator.local`, so a fresh worktree lacked the mode-local override
 * that carries the local emulator config (C-526 remediation). Any new mode
 * added to AIKAMI_MODES automatically gains both suffixes.
 */
export const ENV_FILE_SUFFIXES = [
  '.env.local',
  ...AIKAMI_MODES.flatMap((mode) => [`.env.${mode}`, `.env.${mode}.local`]),
  '.env.testing',
  '.env.testing.local',
];

/**
 * Env-file seed entries for every app in APP_CONFIG, derived from its `path`
 * so a new app or a new env file automatically gets seeded into worktrees
 * without touching this file — this is what fixed C-417's missing
 * `apps/frontend/site/.env.emulator` (added by hand and immediately went
 * stale for `hub`, `docs`, etc.). Dedupes by path since `client-tauri`
 * reuses `client`'s path.
 */
const appConfigEnvSeedPaths = (): WorktreeSeedEntry[] => {
  const seenPaths = new Set<string>();
  const entries: WorktreeSeedEntry[] = [];
  for (const config of Object.values(APP_CONFIG)) {
    if (seenPaths.has(config.path)) {
      continue;
    }
    seenPaths.add(config.path);
    for (const suffix of ENV_FILE_SUFFIXES) {
      const relPath = `${config.path}/${suffix}`;
      entries.push({ from: relPath, to: relPath, kind: 'file', optional: true });
    }
  }
  return entries;
};

/**
 * Gitignored-but-required files copied from the root checkout during
 * bootstrap. Without these, dev servers / typecheck / tests can't run
 * in a worktree (they are gitignored, so a fresh checkout lacks them).
 * Each entry: { from (relative to repoRoot), to (relative to checkout),
 * kind: 'file' | 'dir', optional: true }.
 */
export const WORKTREE_SEED_PATHS: WorktreeSeedEntry[] = [
  // Root env files
  { from: '.env', to: '.env', kind: 'file', optional: true },
  { from: '.env.emulator', to: '.env.emulator', kind: 'file', optional: true },
  { from: '.env.local', to: '.env.local', kind: 'file', optional: true },
  {
    from: '.env.emulator.local',
    to: '.env.emulator.local',
    kind: 'file',
    optional: true,
  },
  // Per-app env files (client, site, hub, docs, ...) — see APP_CONFIG.
  ...appConfigEnvSeedPaths(),
  // E2E + scripts env (not APP_CONFIG entries). `apps/e2e/.env` carries the
  // visual runner's OPENROUTER_API_KEY; `scripts/.env` carries script-side
  // secrets — both are gitignored and absent from a raw checkout.
  { from: 'apps/e2e/.env', to: 'apps/e2e/.env', kind: 'file', optional: true },
  { from: 'scripts/.env', to: 'scripts/.env', kind: 'file', optional: true },
  // GCP service-account keys (needed by gcloud deploys)
  { from: '.secrets', to: '.secrets', kind: 'dir', optional: true },
  // Paraglide generated i18n files — gitignored, required for client
  // typecheck/build/dev (Vite re-generates them, but only when running).
  {
    from: 'apps/frontend/client/src/lib/paraglide',
    to: 'apps/frontend/client/src/lib/paraglide',
    kind: 'dir',
    optional: true,
  },
];

/** Copy gitignored files and return every source path that failed to copy. */
export const seedWorktreeFiles = (options: {
  checkoutPath: string;
  repoRoot: string;
}): string[] => {
  const { checkoutPath, repoRoot } = options;
  const failedSeeds: string[] = [];
  for (const entry of WORKTREE_SEED_PATHS) {
    const src = join(repoRoot, entry.from);
    const dst = join(checkoutPath, entry.to);
    if (!existsSync(src)) {
      if (!entry.optional) {
        console.warn(`⚠️  Required seed file missing in root: ${entry.from}`);
      }
      continue;
    }
    try {
      if (entry.kind === 'dir') {
        // Merge on retries so a partial directory left by a failed cpSync is
        // completed, while force:false preserves worktree-local changes.
        cpSync(src, dst, { recursive: true, force: false });
      } else {
        mkdirSync(join(dst, '..'), { recursive: true });
        if (!existsSync(dst)) {
          copyFileSync(src, dst);
        }
      }
    } catch (err: unknown) {
      failedSeeds.push(entry.from);
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Could not seed ${entry.from} → ${entry.to}: ${message}`);
    }
  }
  return failedSeeds;
};

/**
 * Seed files present in the ROOT checkout but absent from the worktree.
 *
 * Mirror of `missingWorktreeDeps`: an env file that exists in root but not in
 * the worktree means a dev server / E2E lane will boot with the wrong mode (or
 * fail validation) for no visible reason. Reported per-entry so the operator
 * sees every gap at once instead of discovering them one failed run at a time.
 *
 * Only entries whose SOURCE exists are reported — a seed that is absent from
 * root too is genuinely optional and not a worktree defect.
 */
export const missingWorktreeSeeds = (options: {
  checkoutPath: string;
  repoRoot: string;
  failedSeeds?: readonly string[];
}): string[] => {
  const { checkoutPath, repoRoot } = options;
  const failedSeeds = new Set(options.failedSeeds);
  return WORKTREE_SEED_PATHS.filter((entry) => {
    if (!existsSync(join(repoRoot, entry.from))) {
      return false;
    }
    return failedSeeds.has(entry.from) || !existsSync(join(checkoutPath, entry.to));
  }).map((entry) => entry.from);
};
