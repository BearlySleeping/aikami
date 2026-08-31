// scripts/src/lib/ops/pin_dependencies.ts
//
// After syncpack updates all deps, this restores specific packages
// to their pinned versions.
//
// ── @playwright/test ─────────────────────────────────────────────
// Pinned to match the Nix flake's browser cache.
//
// Priority:
//   1. Nix-provided playwright (playwright --version) — the authoritative source
//   2. Installed npm package version (node_modules)
//   3. Hardcoded fallback (must match Nix flake)
//
// On NixOS, the flake provides playwright-test + playwright-driver via
// playwright-web-flake. The npm @playwright/test MUST match the Nix
// version exactly, because PLAYWRIGHT_BROWSERS_PATH points to Nix-managed
// browsers that are version-locked to the driver.
//
// ── typescript ──────────────────────────────────────────────────
// Pinned to 6.0.3 because TypeScript 7 is not yet supported by
// vtsls (Zed's TypeScript LSP) and other tooling in the ecosystem.
// Remove this pin once vtsls ships TS 7 compatibility.
//
// ── @astrojs/starlight ───────────────────────────────────────────
// Pinned because starlight ships raw .ts source files in its npm
// package (withastro/starlight#2644, #3572). TypeScript checks these
// files regardless of `skipLibCheck` or `exclude` since they're
// resolved through `moduleResolution: "bundler"`. Upgrading starlight
// may introduce new type errors from upstream .ts changes.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Windows workaround ──────────────────────────────────────────
//
// `bun add` inside a workspace subdirectory fails on Windows with:
//   "@aikami/frontend-engine" is not a valid install folder name
//
// This is a bun workspace resolution bug on Windows (bun#14939-ish).
// The workaround: run `bun add` from the monorepo root with the
// `--filter` flag targeting the workspace package name, which
// avoids the broken workspace-protocol resolution path.
//
function bunAddInWorkspace(pkgName: string, pkgDir: string, pkgSpec: string): void {
  const isWindows = process.platform === 'win32';
  const args = ['add', ...pkgSpec.split(' ')];
  if (isWindows) {
    // Run from root with --filter to work around bun workspace resolution bug
    args.push('--filter', pkgName);
  }
  // Use the filesystem directory path for cwd, not the workspace package name
  const cwd = isWindows ? MONOREPO_ROOT : resolve(MONOREPO_ROOT, pkgDir);
  // Use process.execPath to get the full path to the current Bun binary.
  // When `bun run` executes a script, it sanitizes PATH to only include
  // node_modules/.bin directories, so just 'bun' may not be resolvable
  // for child process spawning.
  const bunPath = process.execPath;
  const result = spawnSync(bunPath, args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`spawnSync error: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`bun add was killed by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`bun add exited with code ${result.status}`);
  }
}

const MONOREPO_ROOT = resolve(import.meta.dir, '../../../..');

function findCurrentPlaywrightVersion(): string {
  // 1. Nix-provided playwright binary (authoritative on NixOS)
  try {
    const result = spawnSync('playwright', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status === 0) {
      const output = result.stdout;
      const match = output.match(/Version (\d+\.\d+\.\d+)/);
      if (match) {
        console.log(`   📌 Nix playwright version: ${match[1]}`);
        return match[1];
      }
    }
  } catch {
    /* nix playwright not in PATH — fall through */
  }

  // 2. Installed npm package version
  const pwaPkgPath = resolve(
    MONOREPO_ROOT,
    'apps/frontend/client/node_modules/@playwright/test/package.json',
  );
  if (existsSync(pwaPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pwaPkgPath, 'utf-8'));
      return pkg.version;
    } catch {
      /* fall through */
    }
  }

  // 3. Hardcoded fallback — must match playwright-web-flake in flake.nix
  return '1.59.1';
}

// ── Main ────────────────────────────────────────────────────────

const currentVersion = findCurrentPlaywrightVersion();

// Validate currentVersion before using it in shell commands
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(currentVersion)) {
  throw new Error(
    `Invalid Playwright version detected: "${currentVersion}". Expected semver format (e.g., "1.59.1").`,
  );
}

// Packages that depend on @playwright/test (check both for devDependency)
type WorkspaceInfo = { dir: string; name: string };

const playwrightDirs: WorkspaceInfo[] = ['apps/frontend/client', 'apps/e2e']
  .filter((dir) => {
    const pkgPath = resolve(MONOREPO_ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) {
      return false;
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return '@playwright/test' in (pkg.devDependencies || {});
    } catch {
      return false;
    }
  })
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, dir, 'package.json'), 'utf-8'));
    return { dir, name: pkg.name };
  });

console.log(`🔒 Pinning @playwright/test to ${currentVersion}`);

// Packages that also depend on `playwright` (the CLI/driver package)
const playwrightCliDirs: WorkspaceInfo[] = ['apps/e2e']
  .filter((dir) => {
    const pkgPath = resolve(MONOREPO_ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) {
      return false;
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return 'playwright' in (pkg.devDependencies || {});
    } catch {
      return false;
    }
  })
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, dir, 'package.json'), 'utf-8'));
    return { dir, name: pkg.name };
  });

let hasError = false;
for (const { dir, name } of playwrightDirs) {
  try {
    bunAddInWorkspace(name, dir, `-d @playwright/test@${currentVersion} --exact`);
    console.log(`✅ Pinned @playwright/test@${currentVersion} in ${dir}`);
  } catch (err) {
    console.error(
      `⚠️  Failed to pin @playwright/test in ${dir}:`,
      err instanceof Error ? err.message : String(err),
    );
    hasError = true;
  }
}

// Pin `playwright` CLI package to the same version as @playwright/test
console.log(`🔒 Pinning playwright to ${currentVersion}`);
for (const { dir, name } of playwrightCliDirs) {
  try {
    bunAddInWorkspace(name, dir, `-d playwright@${currentVersion} --exact`);
    console.log(`✅ Pinned playwright@${currentVersion} in ${dir}`);
  } catch (err) {
    console.error(
      `⚠️  Failed to pin playwright in ${dir}:`,
      err instanceof Error ? err.message : String(err),
    );
    hasError = true;
  }
}

// ── @astrojs/starlight ──────────────────────────────────────────

function findCurrentStarlightVersion(): string {
  // Read from the installed package in docs/node_modules
  const starlightPkgPath = resolve(
    MONOREPO_ROOT,
    'apps/frontend/docs/node_modules/@astrojs/starlight/package.json',
  );
  if (existsSync(starlightPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(starlightPkgPath, 'utf-8'));
      console.log(`   📌 Installed @astrojs/starlight: ${pkg.version}`);
      return pkg.version;
    } catch {
      /* fall through */
    }
  }

  // Fallback: read from the docs package.json directly
  const docsPkgPath = resolve(MONOREPO_ROOT, 'apps/frontend/docs/package.json');
  if (existsSync(docsPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(docsPkgPath, 'utf-8'));
      const version = pkg.dependencies?.['@astrojs/starlight'];
      if (version) {
        return version.replace(/^[\^~]/, '');
      }
    } catch {
      /* fall through */
    }
  }

  return '0.40.0';
}

const starlightVersion = findCurrentStarlightVersion();
console.log(`🔒 Pinning @astrojs/starlight to ${starlightVersion}`);

try {
  bunAddInWorkspace('@aikami/docs', 'apps/frontend/docs', `@astrojs/starlight@${starlightVersion} --exact`);
  console.log(`✅ Pinned @astrojs/starlight@${starlightVersion} in apps/frontend/docs`);
} catch (err) {
  console.error(
    '⚠️  Failed to pin @astrojs/starlight in apps/frontend/docs:',
    err instanceof Error ? err.message : String(err),
  );
  hasError = true;
}

// ── typescript ──────────────────────────────────────────────────

const TYPESCRIPT_VERSION = '6.0.3';
const tsDirs: WorkspaceInfo[] = [
  { dir: '.', name: '@aikami/monorepo' },
  { dir: 'apps/e2e', name: '@aikami/e2e' },
  { dir: 'packages/backend/ai', name: '@aikami/backend-ai' },
].filter(({ dir }) => {
  const pkgPath = resolve(MONOREPO_ROOT, dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return 'typescript' in (pkg.devDependencies || {});
  } catch {
    return false;
  }
});

console.log(`🔒 Pinning typescript to ${TYPESCRIPT_VERSION}`);

for (const { dir, name } of tsDirs) {
  try {
    bunAddInWorkspace(name, dir, `-d typescript@${TYPESCRIPT_VERSION} --exact`);
    console.log(`✅ Pinned typescript@${TYPESCRIPT_VERSION} in ${dir}`);
  } catch (err) {
    console.error(
      `⚠️  Failed to pin typescript in ${dir}:`,
      err instanceof Error ? err.message : String(err),
    );
    hasError = true;
  }
}

// ── Exit ────────────────────────────────────────────────────────

if (hasError) {
  process.exit(1);
}
