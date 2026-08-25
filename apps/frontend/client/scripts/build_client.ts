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

// 1. Dev-route gate — must see the same mode svelte.config.js will.
run('gate dev routes', 'bun', ['scripts/gate_dev_routes.ts', ...modeArgs]);

// 2. Web bundle. Extra args are forwarded here, where they were aimed.
//    AIKAMI_BUILD_MODE is exported so svelte.config.js sees the real mode:
//    SvelteKit loads it during a config probe that runs before vite resolves
//    `--mode`, and without this it falls back to production and demands the
//    filtered routes copy a non-production build never creates.
const viteEnv = { ...process.env };
if (mode) {
  viteEnv.AIKAMI_BUILD_MODE = mode;
}
run('vite build', 'bunx', ['vite', 'build', ...modeArgs, ...passthrough], { env: viteEnv });

// 3. Guard the emitted chunk graph. A static-import cycle between chunks
//    breaks module evaluation order and only surfaces at runtime.
run('check bundle', 'bun', ['scripts/check_bundle.ts']);
