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
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DEV_ROUTES_BUILD_MARKER_FILE } from '@aikami/constants';
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

/**
 * Whether this build's route graph contains `(dev)`.
 *
 * `buildEnv` — not `process.env` — is the authority for the override: it
 * normally arrives from `.env.<mode>`, which is loaded here and is not
 * otherwise exported into this process. `mode ?? 'production'` matches Vite's
 * own default for a bare invocation, so this agrees with what vite.config.ts
 * and scripts/gate_dev_routes.ts resolve for the same build.
 *
 * Desktop builds always opt in, because the desktop QA surface is the reason
 * this flag exists.
 */
const allowDevRoutesForBuild =
  resolveIncludeDevRoutes({
    command: 'build',
    mode: mode ?? 'production',
    env: buildEnv,
  }) || process.env.AIKAMI_DESKTOP_BUILD === 'true';

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

// 2a. Record the route decision inside the build output. The deploy
//     orchestrator runs its own `check_deploy_assets` pass in a different
//     process, where the mode env file is not loaded — so re-deriving the
//     decision from `process.env` there silently disagreed with this build and
//     rejected a dev-route output the build had explicitly produced. The record
//     travels with the artifact (including checksum-cache and CI reuse), which
//     makes "the guard cannot disagree with the build" true by construction.
await Bun.write(
  join(CLIENT_DIR, 'build', DEV_ROUTES_BUILD_MARKER_FILE),
  `${JSON.stringify({ includeDevRoutes: allowDevRoutesForBuild }, null, 2)}\n`,
);

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
const allowDevRoutes = allowDevRoutesForBuild;
if (allowDevRoutes) {
  // Report the route graph, not the variable's value: the staging default
  // includes `(dev)` with the variable unset, so "…=true" would misreport the
  // most common case.
  const desktopOverride = process.env.AIKAMI_DESKTOP_BUILD === 'true';
  const envOverride = buildEnv[DEV_ROUTES_ENV_VAR] === 'true';
  const decidedBy =
    desktopOverride || envOverride
      ? `${DEV_ROUTES_ENV_VAR}/desktop override`
      : `${DEV_ROUTES_ENV_VAR} unset + mode '${mode ?? 'production'}'`;
  logger.info(`[build-client] dev routes are expected in this build — decided by ${decidedBy}.`);
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
//    The committed baseline measures the STAGING route graph — the larger one,
//    with the `(dev)` sandboxes — so the ratchet is meaningful there. A
//    production build emits fewer bytes against that baseline and therefore
//    clears it without help, which is why `--expect-dev-routes` is NOT passed:
//    suppressing the ratchet for a smaller graph would only hide regressions.
//    Passing it becomes correct again only once the baseline measures a
//    production-graph build, which is part of reverting the staging exception
//    in scripts/dev_routes_gate.ts.
run('report bundle budget', 'bun', ['scripts/report_bundle_budget.ts']);
