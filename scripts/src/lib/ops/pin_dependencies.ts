// scripts/src/lib/ops/pin_dependencies.ts
//
// After syncpack updates all deps, this restores @playwright/test
// to the version compatible with the Nix flake's browser cache.
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
  if (!existsSync(pkgPath)) return false;
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

if (hasError) {
  process.exit(1);
}
