#!/usr/bin/env bun

/**
 * Wrapper around `tauri build` that only asks for bundles the host can
 * actually produce.
 *
 *   bun run tauri:build                  → auto-picks bundle targets
 *   bun run tauri:build --bundles deb    → explicit; the wrapper stays out of it
 *   bun run tauri:build --no-bundle      → explicit; the wrapper stays out of it
 *   TAURI_BUNDLE_TARGETS=deb bun run tauri:build
 *
 * Why this exists — Tauri's AppImage bundler is hard-wired to a Debian-shaped
 * filesystem. It copies `/usr/bin/xdg-mime` and `/usr/bin/xdg-open` into the
 * AppDir (required because we ship tauri-plugin-deep-link) and pulls webkit/
 * gtk/gstreamer libraries out of `/usr/lib/x86_64-linux-gnu`. NixOS has none
 * of those paths, so `tauri build` dies with:
 *
 *   failed to bundle project xdg-mime binary not found /usr/bin/xdg-mime
 *
 * even though xdg-utils IS on PATH from the flake — the bundler never consults
 * PATH, and no flag or env var redirects those lookups. So on such a host we
 * default to --no-bundle, which still produces the optimized
 * `src-tauri/target/release/aikami`. That binary is everything you need to
 * debug the real desktop app, deep links included: lib.rs calls
 * `deep_link().register_all()` at startup, and *that* does resolve xdg-mime
 * from PATH.
 *
 * Release AppImages come from CI (ubuntu-22.04, see ci_planning.ts), which
 * invokes `bun run tauri build --bundles …` directly and never reaches here.
 * For an AppImage on this machine, see `bun run scripts -- tauri_appimage`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@aikami/logger';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Binaries the AppImage bundler reads from a hard-coded absolute path. */
const APPIMAGE_REQUIRED_PATHS = ['/usr/bin/xdg-mime', '/usr/bin/xdg-open'] as const;

const missingAppImageDep = (): string | undefined =>
  process.platform === 'linux'
    ? APPIMAGE_REQUIRED_PATHS.find((path) => !existsSync(path))
    : undefined;

const args = process.argv.slice(2);
const callerChoseBundles = args.some(
  (arg) =>
    arg === '--no-bundle' || arg === '-b' || arg === '--bundles' || arg.startsWith('--bundles='),
);

const extraArgs: string[] = [];
const missingDep = missingAppImageDep();

if (callerChoseBundles) {
  // Caller was explicit — never second-guess it.
} else if (process.env.TAURI_BUNDLE_TARGETS) {
  extraArgs.push('--bundles', process.env.TAURI_BUNDLE_TARGETS);
} else if (missingDep) {
  // CI is expected to run on a distro that can bundle; failing loudly there
  // beats silently publishing a release with no installers attached.
  if (process.env.CI) {
    logger.error(`❌ ${missingDep} is missing — this runner cannot build an AppImage.`);
    process.exit(1);
  }
  extraArgs.push('--no-bundle');
  logger.warn(`\n⚠️  ${missingDep} is missing (NixOS?) — skipping the bundling step.`);
  logger.warn('   You still get the release binary; run it with: bun run tauri:run');
  logger.warn('   Want a package anyway?  bun run tauri:build --bundles deb');
  logger.warn('   Want a real AppImage?   bun run scripts -- tauri_appimage\n');
}

const finalArgs = ['tauri', 'build', ...args, ...extraArgs];
logger.info(`\n▶ bunx ${finalArgs.join(' ')}`);

const result = spawnSync('bunx', finalArgs, {
  stdio: 'inherit',
  cwd: CLIENT_DIR,
  // Windows needs a shell to resolve the bunx .cmd shim.
  shell: process.platform === 'win32',
});

if (result.error) {
  logger.error(`❌ Failed to spawn tauri: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const binPath = join(CLIENT_DIR, 'src-tauri/target/release/aikami');
if (existsSync(binPath)) {
  logger.info(`\n✅ Release binary: ${binPath}`);
  logger.info('   Launch it with: bun run tauri:run');
}
