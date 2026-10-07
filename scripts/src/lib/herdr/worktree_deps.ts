// scripts/src/lib/herdr/worktree_deps.ts
//
// Dependency installation for a fresh worktree checkout — the platform-split
// install strategy plus the post-condition that proves the resulting
// node_modules is actually complete.
//
// Why this is its own module (carved out of worktree.ts, which sits on a size
// waiver): dependency provisioning is one decision with one owner — "how does
// this platform get a usable node_modules, and how do we know it worked" — and
// it is the part most likely to be platform-gated wrongly. Keeping the Windows
// workaround and its POSIX counterpart side by side here is what makes the
// gating obvious to the next reader.
//
// Both paths are load-bearing and neither is a fallback for the other:
//   - POSIX installs normally; bun hardlinks from the shared global cache.
//   - Windows seeds a deliberately PARTIAL tree by hand, because bun 1.4.0
//     cannot install workspace packages with `/` in their names.
//
// `missingWorktreeDeps` is exported because the completeness check it drives
// is the only thing standing between a half-provisioned worktree and a failure
// discovered at pre-push, after an implementer and a verifier have both passed.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { reportInfraIssue } from '../ops/infra_report.ts';

/** Default `bun install` budget for a cold worktree. */
const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;

/**
 * A real directory symlink ('dir') needs SeCreateSymbolicLinkPrivilege on
 * Windows; a junction needs no privilege for directories specifically (POSIX
 * ignores the type argument). This is not a fallback — it removes the
 * privilege requirement entirely.
 */
const dirSymlinkType = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * Install a worktree's dependencies, then verify the tree is complete.
 *
 * @returns true only when the dependency tree is present AND complete.
 */
export const installWorktreeDeps = (options: {
  checkoutPath: string;
  repoRoot: string;
  /** `bun install` budget in ms (default 180_000 — cold worktrees are slow). */
  installTimeoutMs?: number;
}): boolean => {
  const { checkoutPath, repoRoot } = options;
  const installed = shouldSeedWindowsTree(checkoutPath)
    ? seedWindowsWorktreeNodeModules(checkoutPath, repoRoot)
    : runBunInstall(checkoutPath, repoRoot, options.installTimeoutMs);

  // ── Post-condition: the dep tree must actually be complete ──
  // 🔴 The TS2688 failure this guards against was silent: bootstrap reported
  // success, the implementer and verifier both passed, and the missing deps
  // only surfaced at pre-push — the most expensive possible place to learn the
  // worktree was never usable. Diffing against root's own top-level entries
  // keeps this self-maintaining: it needs no hardcoded package list and stays
  // correct as dependencies come and go.
  const missing = missingWorktreeDeps({ checkoutPath, repoRoot });
  if (missing.length === 0) {
    return installed;
  }
  console.warn(
    `⚠️  Incomplete node_modules in ${checkoutPath} — missing ${missing.join(', ')}. ` +
      `Typecheck will fail (TS2688). Run: cd ${checkoutPath} && bun install`,
  );
  reportInfraIssue({
    component: 'worktree_bootstrap',
    operation: 'verify node_modules',
    error: new Error(`Missing top-level node_modules entries: ${missing.join(', ')}`),
    context: { checkoutPath, missing: missing.join(','), platform: process.platform },
    cwd: repoRoot,
  });
  return false;
};

/**
 * Whether the Windows hand-seeded tree is the install path for this worktree.
 *
 * 🔴 The `win32` gate is load-bearing and must not be relaxed. bun 1.4.0 on
 * Windows cannot install workspace packages with `/` in their names (e.g.
 * `@aikami/frontend/engine`) — "is not a valid install folder name" — so those
 * machines get a hand-built tree instead. Running the seeding on Linux/macOS
 * (as it did until C-476) left every fresh worktree with a 3-entry
 * node_modules, so `tsc` could not resolve `types: ["bun"]` and pre-push
 * validation died with TS2688 — after the implementer and verifier had both
 * already passed. On POSIX the plain install is both correct and fast: bun
 * hardlinks out of the shared global cache.
 *
 * The `!existsSync` half is why the seeding is not merely a Windows fallback:
 * a fresh checkout never has a node_modules to find, so without it the branch
 * below would be unreachable there.
 */
const shouldSeedWindowsTree = (checkoutPath: string): boolean =>
  process.platform === 'win32' && !existsSync(join(checkoutPath, 'node_modules'));

/** The ordinary install: every POSIX worktree, and Windows ones already seeded. */
const runBunInstall = (
  checkoutPath: string,
  repoRoot: string,
  installTimeoutMs?: number,
): boolean => {
  try {
    execSync('bun install --frozen-lockfile', {
      cwd: checkoutPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
      windowsHide: true,
    });
    return true;
  } catch (err: unknown) {
    console.warn(
      `⚠️  bun install failed in ${checkoutPath}. Run it manually: cd ${checkoutPath} && bun install`,
    );
    reportInfraIssue({
      component: 'worktree_bootstrap',
      operation: 'bun install --frozen-lockfile',
      error: err,
      context: { checkoutPath },
      cwd: repoRoot,
    });
    return false;
  }
};

/**
 * Hand-build a Windows worktree's node_modules (see shouldSeedWindowsTree for
 * why this exists). Each step is a separate helper so no single branch body
 * carries the whole strategy.
 */
const seedWindowsWorktreeNodeModules = (checkoutPath: string, repoRoot: string): boolean => {
  const worktreeNodeModules = join(checkoutPath, 'node_modules');
  mkdirSync(worktreeNodeModules, { recursive: true });
  const workspaces = readWorkspaceGlobs(repoRoot);
  linkBunCache(repoRoot, worktreeNodeModules);
  linkAikamiPackages(checkoutPath, worktreeNodeModules, workspaces);
  linkBinShims(repoRoot, worktreeNodeModules);
  linkPerAppNodeModules(checkoutPath, repoRoot, workspaces);
  return true;
};

/** Junction the shared `.bun` cache (non-workspace deps) from the root.
 *  🔴 cpSync fails with EPERM on symlinks inside the cache. Use junction instead. */
const linkBunCache = (repoRoot: string, worktreeNodeModules: string): void => {
  const rootBunCache = join(repoRoot, 'node_modules', '.bun');
  if (!existsSync(rootBunCache)) {
    return;
  }
  try {
    symlinkSync(rootBunCache, join(worktreeNodeModules, '.bun'), 'junction');
  } catch (err: unknown) {
    console.warn(
      `⚠️  Could not junction .bun cache: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/** Link each `@aikami/*` package to the WORKTREE's own source dir, not root's. */
const linkAikamiPackages = (
  checkoutPath: string,
  worktreeNodeModules: string,
  workspaces: string[],
): void => {
  const aikamiDir = join(worktreeNodeModules, '@aikami');
  mkdirSync(aikamiDir, { recursive: true });
  for (const pkg of aikamiPackageDirs(checkoutPath, workspaces)) {
    const targetDir = join(aikamiDir, ...pkg.name.slice('@aikami/'.length).split('/'));
    mkdirSync(join(targetDir, '..'), { recursive: true });
    try {
      symlinkSync(pkg.dir, targetDir, 'junction');
    } catch (err: unknown) {
      console.warn(
        `⚠️  Could not link ${pkg.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
};

/** Every `@aikami/*` package directory inside the worktree's workspace globs. */
const aikamiPackageDirs = (
  checkoutPath: string,
  workspaces: string[],
): Array<{ name: string; dir: string }> => {
  const found: Array<{ name: string; dir: string }> = [];
  for (const wsGlob of workspaces) {
    const dir = join(checkoutPath, wsGlob.replace(/\*$/, ''));
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir)) {
      const pkgPath = join(dir, entry, 'package.json');
      if (!existsSync(pkgPath)) {
        continue;
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name?.startsWith('@aikami/')) {
        found.push({ name: pkg.name, dir: join(dir, entry) });
      }
    }
  }
  return found;
};

/**
 * Link `node_modules/.bin` from the root — required for the pre-commit hook.
 *
 * 🔴 Without this the worktree has no `moon`, `biome` or `tsc` on its
 * resolution path, so `bun run pre-commit` (from .moon/hooks/pre-commit, which
 * every worktree inherits via the shared core.hooksPath) dies at step 2 and the
 * implementer agent's own commits go through unchecked.
 *
 * A link to root's `.bin` is correct rather than a copy: the shims inside are
 * RELATIVE symlinks (`moon -> ../@moonrepo/cli/moon.js`), so they resolve
 * against root's real node_modules where those packages actually live. Moon
 * still treats the worktree as its own workspace root — it walks up from cwd
 * for `.moon/`, which the worktree has — so the checks run against worktree
 * code, not root's.
 */
const linkBinShims = (repoRoot: string, worktreeNodeModules: string): void => {
  const rootBin = join(repoRoot, 'node_modules', '.bin');
  const worktreeBin = join(worktreeNodeModules, '.bin');
  if (!existsSync(rootBin) || existsSync(worktreeBin)) {
    return;
  }
  try {
    symlinkSync(rootBin, worktreeBin, dirSymlinkType);
  } catch (err: unknown) {
    console.warn(
      `⚠️  Could not link node_modules/.bin (${err instanceof Error ? err.message : String(err)}) — ` +
        'pre-commit checks will be skipped in this worktree.',
    );
  }
};

/** Junction each app's own node_modules from the root (vite, pixi.js, etc.). */
const linkPerAppNodeModules = (
  checkoutPath: string,
  repoRoot: string,
  workspaces: string[],
): void => {
  for (const wsGlob of workspaces) {
    const base = wsGlob.replace(/\*$/, '');
    const rootDir = join(repoRoot, base);
    const worktreeDir = join(checkoutPath, base);
    if (!existsSync(rootDir) || !existsSync(worktreeDir)) {
      continue;
    }
    for (const entry of readdirSync(rootDir)) {
      const srcNm = join(rootDir, entry, 'node_modules');
      const dstNm = join(worktreeDir, entry, 'node_modules');
      if (!existsSync(srcNm) || existsSync(dstNm)) {
        continue;
      }
      try {
        symlinkSync(srcNm, dstNm, 'junction');
      } catch {
        // skip
      }
    }
  }
};

/** Workspace globs declared by the root package.json (e.g. `apps/*`). */
const readWorkspaceGlobs = (repoRoot: string): string[] => {
  try {
    return (
      (
        JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
          workspaces?: string[];
        }
      ).workspaces ?? []
    );
  } catch {
    return [];
  }
};

/**
 * Top-level `node_modules` entries present in the root checkout but absent from
 * the worktree. `@aikami/*` is excluded: worktrees deliberately point those at
 * their own source dirs rather than root's. Dotted entries (`.bun`, `.bin`)
 * are excluded too — they are caches and shim dirs, not deps.
 *
 * `$`-prefixed entries are SvelteKit virtual roots (`$app`, written by
 * `svelte-kit sync`) — generated on demand in whatever checkout first runs
 * `typecheck`/`build`, never installed by `bun install`. Comparing them across
 * checkouts produced a persistent false "Incomplete node_modules — missing
 * $app" warning on every fresh worktree; no npm package name can begin with
 * `$`, so excluding the prefix is safe and self-maintaining.
 */
export const missingWorktreeDeps = (options: {
  checkoutPath: string;
  repoRoot: string;
}): string[] => {
  const { checkoutPath, repoRoot } = options;
  const rootNodeModules = join(repoRoot, 'node_modules');
  const worktreeNodeModules = join(checkoutPath, 'node_modules');
  if (!existsSync(rootNodeModules)) {
    return [];
  }
  return readdirSync(rootNodeModules)
    .filter((entry) => !entry.startsWith('.') && entry !== '@aikami' && !entry.startsWith('$'))
    .filter((entry) => !existsSync(join(worktreeNodeModules, entry)));
};
