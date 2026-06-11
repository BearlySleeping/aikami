// scripts/src/lib/ops/pin_dependencies.ts
//
// After syncpack updates all deps, this restores @playwright/test
// to the version compatible with the Nix flake's browser cache.
//
// Priority:
//   1. Version in flake.lock (playwright-flake pinned ref)
//   2. Version from installed browser (PLAYWRIGHT_BROWSERS_PATH)
//   3. Hardcoded fallback (1.60.0)

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MONOREPO_ROOT = resolve(import.meta.dir, '../../../..');

function findCurrentPlaywrightVersion(): string {
  // 1. Try reading the installed npm package version
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

  // 2. Try reading from bun.lock
  try {
    const lock = readFileSync(resolve(MONOREPO_ROOT, 'bun.lock'), 'utf-8');
    const match = lock.match(/"@playwright\/test":\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
  } catch {
    /* fall through */
  }

  // 3. Hardcoded fallback
  return '1.60.0';
}

// ── Main ────────────────────────────────────────────────────────

const currentVersion = findCurrentPlaywrightVersion();
const pwaDir = resolve(MONOREPO_ROOT, 'apps/frontend/client');

console.log(`🔒 Pinning @playwright/test to ${currentVersion}`);

try {
  execSync(`bun add -d @playwright/test@${currentVersion} --exact`, {
    cwd: pwaDir,
    stdio: 'inherit',
  });
  console.log(`✅ Pinned @playwright/test@${currentVersion}`);
} catch (err) {
  console.error(
    `⚠️  Failed to pin @playwright/test:`,
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
}
