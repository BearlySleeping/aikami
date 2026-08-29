// scripts/src/lib/ops/setup_build_cache.ts
//
// C-449 AC-3: Local build cache setup — ensures CI-equivalent cache directories
// exist so warm local builds are measurably faster. No GitHub Actions cache API
// dependency; works entirely with local persistent directories.
//
// Usage:
//   bun run scripts/src/lib/ops/setup_build_cache.ts
//
// Or import and call setupBuildCache() from another script.
//
// Cache directories created:
//   ~/.bun/install/cache         — Bun dependency cache (matches CI)
//   apps/frontend/client/src-tauri/target  — Rust target dir (matches CI)

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIRS = [
  // Bun install cache (matches actions/cache@v6 key in release.yml)
  join(homedir(), '.bun', 'install', 'cache'),
  // Rust target dir for Tauri (matches Swatinem/rust-cache@v2 workspace in release.yml)
  join(process.cwd(), 'apps', 'frontend', 'client', 'src-tauri', 'target'),
];

/**
 * Ensure CI-matching cache directories exist for local warm builds.
 * Prints status for each directory.
 */
export function setupBuildCache(): void {
  console.log('Setting up local build cache directories…\n');

  for (const dir of CACHE_DIRS) {
    if (existsSync(dir)) {
      console.log(`  ✓ ${dir} — already exists`);
    } else {
      mkdirSync(dir, { recursive: true });
      console.log(`  ✗ ${dir} — created`);
    }
  }

  console.log('\nDone. Cache directories are ready for warm local builds.');
  console.log('Run your build as usual: moon run <app>:build');
  console.log('The second build (no dependency changes) will be measurably faster.');
}

// Run directly
setupBuildCache();
