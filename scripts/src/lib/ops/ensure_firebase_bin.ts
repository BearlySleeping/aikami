#!/usr/bin/env bun
/**
 * Ensure the `firebase-functions` bin shim exists for firebase-tools on Windows.
 *
 * WHY: firebase-tools 15.26's `findFunctionsBinary()` looks for an
 * extensionless `node_modules/.bin/firebase-functions` next to the resolved
 * firebase-functions SDK, then spawns it to discover exported functions.
 * On Linux/macOS, bun creates extensionless shims in `.bin`, so this works.
 * On Windows, bun only creates `firebase-functions.exe` + `firebase-functions.bunx`
 * — the extensionless file is missing, so every `firebase deploy` fails with
 * `Failed to find location of Firebase Functions SDK`.
 *
 * Because `apps/backend/firebase/node_modules/firebase-functions` is a junction
 * into bun's version-conflict store (`node_modules/.bun/firebase-functions@<v>+<hash>`),
 * `require.resolve` returns the realpath, so the shim must be created inside
 * that `.bun` copy's own `.bin` directory — not the app's `.bin`.
 *
 * Fix: copy the real PE launcher `firebase-functions.exe` to the extensionless
 * name firebase-tools expects. Idempotent and a no-op on non-Windows platforms.
 *
 * Runs automatically after every `bun install` (root `postinstall`), wrapped
 * in `|| true` there so a failure here can never fail `bun install` for the
 * whole monorepo — this fixes a narrow Windows/firebase-tools interop gap,
 * it must never become a reason `bun install` itself breaks. `deploy` /
 * `deploy:local` (apps/backend/firebase/package.json) additionally gate hard
 * on this script directly (exit 1 on failure) as defense-in-depth, since a
 * missing shim there means the deploy would fail anyway with a much more
 * confusing error.
 *
 * Usage:
 *   bun run scripts/src/lib/ops/ensure_firebase_bin.ts
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const _filename = fileURLToPath(import.meta.url);
const ROOT_DIR = resolve(dirname(_filename), '../../../..');

/** The Firebase app that owns the functions SDK install. */
const FIREBASE_APP_DIR = join(ROOT_DIR, 'apps', 'backend', 'firebase');

function findSdkBinDir(appDir: string): string | undefined {
  const requireFromApp = createRequire(join(appDir, 'ensure_firebase_bin.ts'));
  let sdkPath: string;
  try {
    sdkPath = requireFromApp.resolve('firebase-functions');
  } catch {
    return undefined;
  }
  // Same substring logic as firebase-tools' findFunctionsBinary: the
  // node_modules dir that CONTAINS the SDK package.
  const lastNm = sdkPath.lastIndexOf('node_modules');
  if (lastNm < 0) {
    return undefined;
  }
  const sdkNodeModulesPath = sdkPath.slice(0, lastNm + 'node_modules'.length);
  return join(sdkNodeModulesPath, '.bin');
}

const isWindows = process.platform === 'win32';

if (!isWindows) {
  console.log(
    '[ensure-firebase-bin] Skipping — non-Windows platform (bun creates extensionless .bin shims here).',
  );
  process.exit(0);
}

const binDir = findSdkBinDir(FIREBASE_APP_DIR);
if (!binDir) {
  console.error(
    '[ensure-firebase-bin] Could not resolve firebase-functions from',
    FIREBASE_APP_DIR,
  );
  process.exit(1);
}

const target = join(binDir, 'firebase-functions');
const launcher = join(binDir, 'firebase-functions.exe');

if (existsSync(target)) {
  console.log(`[ensure-firebase-bin] OK — shim already exists: ${target}`);
  process.exit(0);
}

if (!existsSync(launcher)) {
  console.error(`[ensure-firebase-bin] Neither shim nor launcher found in ${binDir}`);
  console.error(
    '  contents:',
    existsSync(binDir) ? readdirSync(binDir).join(', ') : '(no .bin dir)',
  );
  process.exit(1);
}

mkdirSync(binDir, { recursive: true });
copyFileSync(launcher, target);
console.log(`[ensure-firebase-bin] Created ${target} from ${launcher}`);
