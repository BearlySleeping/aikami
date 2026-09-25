#!/usr/bin/env bun

/**
 * Builds the client web bundle: dev-route gate → vite build → bundle check.
 *
 * This exists to own argument routing. The deploy pipeline invokes
 * `bun moon run client:build -- --mode <mode>`, and `bun run` appends
 * passthrough args to the END of the script string — so in a plain
 * `a && b && c` chain the mode flag lands on whichever command happens to be
 * last, not on `vite build`. Appending a post-build step to such a chain
 * silently steals the flag and builds the wrong mode. A runner routes each
 * argument deliberately instead.
 *
 * Usage:
 *   bun scripts/build_client.ts                      → vite's default mode
 *   bun scripts/build_client.ts --mode production    → production
 *   bun scripts/build_client.ts --mode staging --foo → extra args reach vite
 *
 * Mode resolution: --mode flag > AIKAMI_BUILD_MODE env > vite's own default.
 */

import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { logger } from '@aikami/logger';
import { loadEnv } from 'vite';
import { DEV_ROUTES_ENV_VAR, resolveIncludeDevRoutes } from './dev_routes_gate.ts';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Split `--mode <m>` / `--mode=<m>` out of the passthrough args ──────────

const argv = process.argv.slice(2);
const passthrough: string[] = [];
let mode: string | undefined;

for (let index = 0; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === '--mode') {
    mode = argv[++index];
  } else if (arg.startsWith('--mode=')) {
    mode = arg.slice('--mode='.length);
  } else {
    passthrough.push(arg);
  }
}

mode ??= process.env.AIKAMI_BUILD_MODE;

/** Runs a command, inheriting stdio; exits with its code on failure. */
const run = (label: string, cmd: string, args: string[], opts: SpawnSyncOptions = {}): void => {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: CLIENT_DIR,
    // Windows needs a shell to resolve .cmd shims (bunx).
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.error) {
    logger.error(`❌ Failed to spawn ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    logger.error(`❌ ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
};

const modeArgs = mode ? ['--mode', mode] : [];
const fileEnv = loadEnv(mode ?? 'production', CLIENT_DIR, ['AIKAMI_', 'PUBLIC_']);
const buildEnv = { ...process.env, ...fileEnv };

// 1. Dev-route gate — must see the same mode and .env file vite.config.ts will.
run('gate dev routes', 'bun', ['scripts/gate_dev_routes.ts', ...modeArgs], { env: buildEnv });

// 2. Web bundle. Extra args are forwarded here, where they were aimed.
//    AIKAMI_BUILD_MODE is exported so vite.config.ts sees the real mode:
//    SvelteKit loads it during a config probe that runs before vite resolves
//    `--mode`, and without this it falls back to production and demands the
//    filtered routes copy a non-production build never creates.
const viteEnv = { ...buildEnv };
if (mode) {
  viteEnv.AIKAMI_BUILD_MODE = mode;
}
// Ensure required PUBLIC_* env vars are set for the configs package
if (!viteEnv.PUBLIC_APP_ID) {
  viteEnv.PUBLIC_APP_ID = 'client';
}
if (!viteEnv.PUBLIC_MODE) {
  viteEnv.PUBLIC_MODE = mode ?? 'production';
}
run('vite build', 'bunx', ['vite', 'build', ...modeArgs, ...passthrough], { env: viteEnv });

// 3. Guard the emitted chunk graph. A static-import cycle between chunks
//    breaks module evaluation order and only surfaces at runtime.
run('check bundle', 'bun', ['scripts/check_bundle.ts']);

// 3a. Debug consoles are development-build affordances. `PUBLIC_MODE=emulator`
//     may target a production preview, so the bundle itself is the authority.
run('check debug console excluded', 'bun', ['scripts/check_no_eruda.ts']);

// 3b. Guard the service worker: SvelteKit emits it as an ES module, so the
//     manual registration in src/app.html must use { type: 'module' }.
run('check service worker', 'bun', ['scripts/check_service_worker.ts', 'build']);

// 4. Guard the deployment assets Cloudflare will actually receive. Fails on
//    any asset at/over Aikami's 24 MiB ceiling, any ORT WASM in the client
//    output, byte-identical large binaries emitted at multiple paths, or a
//    `(dev)` route that leaked into a production graph. A build that
//    explicitly opts into dev routes passes --allow-dev-routes.
//
//    The decision comes from the same resolver the gate itself uses, so the
//    guard can never disagree with the route graph that was actually built.
const allowDevRoutes =
  resolveIncludeDevRoutes('build') || process.env.AIKAMI_DESKTOP_BUILD === 'true';
if (allowDevRoutes) {
  logger.info(`[build-client] ${DEV_ROUTES_ENV_VAR}=true — dev routes are expected in this build.`);
}
run('check deploy assets', 'bun', [
  'scripts/check_deploy_assets.ts',
  'build',
  ...(allowDevRoutes ? ['--allow-dev-routes'] : []),
]);

// 5. Ratchet first-party ineffective dynamic imports against the reviewed
//    baseline. A new one means a module advertised as lazy is eagerly
//    reachable again.
run('check ineffective dynamic imports', 'bun', ['scripts/check_ineffective_dynamic_imports.ts']);

// 6. Report bundle budgets (raw/gzip, totals, per-route initial closures) and
//    ratchet tracked metrics. Kept after the guards so the report reflects an
//    output that already passed the hard gates.
//
//    When dev routes were deliberately included, the ratchet is skipped: the
//    committed baseline measures the production route graph, so a sandbox build
//    would otherwise always report a ~20% regression and fail the build. The
//    flag comes from the same resolver the gate itself uses, so a normal build
//    can never skip the ratchet by accident.
run('report bundle budget', 'bun', [
  'scripts/report_bundle_budget.ts',
  ...(allowDevRoutes ? ['--expect-dev-routes'] : []),
]);
