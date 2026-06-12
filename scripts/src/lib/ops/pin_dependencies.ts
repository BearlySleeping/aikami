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
// ── @astrojs/starlight ───────────────────────────────────────────
// Pinned because starlight ships raw .ts source files in its npm
// package (withastro/starlight#2644, #3572). TypeScript checks these
// files regardless of `skipLibCheck` or `exclude` since they're
// resolved through `moduleResolution: "bundler"`. Upgrading starlight
// may introduce new type errors from upstream .ts changes.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MONOREPO_ROOT = resolve(import.meta.dir, '../../../..');

function findCurrentPlaywrightVersion(): string {
  // 1. Nix-provided playwright binary (authoritative on NixOS)
  try {
    const output = execSync('playwright --version', { encoding: 'utf-8' });
    const match = output.match(/Version (\d+\.\d+\.\d+)/);
    if (match) {
      console.log(`   📌 Nix playwright version: ${match[1]}`);
      return match[1];
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

// Packages that depend on @playwright/test (check both for devDependency)
const playwrightDirs = ['apps/frontend/client', 'apps/e2e'].filter((dir) => {
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
});

console.log(`🔒 Pinning @playwright/test to ${currentVersion}`);

let hasError = false;
for (const dir of playwrightDirs) {
  const absDir = resolve(MONOREPO_ROOT, dir);
  try {
    execSync(`bun add -d @playwright/test@${currentVersion} --exact`, {
      cwd: absDir,
      stdio: 'inherit',
    });
    console.log(`✅ Pinned @playwright/test@${currentVersion} in ${dir}`);
  } catch (err) {
    console.error(
      `⚠️  Failed to pin @playwright/test in ${dir}:`,
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
  execSync(`bun add @astrojs/starlight@${starlightVersion} --exact`, {
    cwd: resolve(MONOREPO_ROOT, 'apps/frontend/docs'),
    stdio: 'inherit',
  });
  console.log(`✅ Pinned @astrojs/starlight@${starlightVersion} in apps/frontend/docs`);
} catch (err) {
  console.error(
    '⚠️  Failed to pin @astrojs/starlight in apps/frontend/docs:',
    err instanceof Error ? err.message : String(err),
  );
  hasError = true;
}

// ── Exit ────────────────────────────────────────────────────────

if (hasError) {
  process.exit(1);
}
