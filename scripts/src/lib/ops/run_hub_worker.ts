#!/usr/bin/env bun
// scripts/src/lib/ops/run_hub_worker.ts
//
// C-437: Run the hub under `wrangler dev --local` with D1 and R2 bindings.
//
// The hub must be built first (`bun moon run hub:build`). This script checks
// that the build artifact exists, then launches wrangler dev in local mode
// so no Cloudflare credentials are needed.
//
// Usage:
//   bun run scripts/src/lib/ops/run_hub_worker.ts
//   bun run dev:worker  (from apps/frontend/hub)
//
// Environment:
//   PORT              — port to listen on (default: PORTS.emulator.hubWorker)
//   CLOUDFLARE_API_TOKEN — if set, wrangler may try remote mode — we assert
//                          --local explicitly to prevent that.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PORTS } from '@aikami/constants';
import { c, error, info, ok } from '../cli_utils.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');
const BUILD_ENTRY = resolve(HUB_DIR, 'build/_worker.js');
const PORT = Number(process.env.PORT) || PORTS.emulator.hubWorker;

// ── Check build exists ──────────────────────────────────────
if (!existsSync(BUILD_ENTRY)) {
  error('Hub build not found at apps/frontend/hub/build/_worker.js');
  info('Build the hub first:');
  info(`  ${c.cyan}bun moon run hub:build${c.reset}`);
  info('Then start the worker:');
  info(`  ${c.cyan}bun run dev:worker${c.reset}  (from apps/frontend/hub)`);
  info(`  ${c.cyan}bun herdr:start hub-worker${c.reset}  (from repo root)`);
  process.exit(1);
}

// ── Run wrangler dev --local ────────────────────────────────
// 🔴 --local is asserted explicitly. Without it, wrangler dev defaults to
// remote mode when CLOUDFLARE_API_TOKEN is set, which would let a first-time
// contributor write to production D1/R2.
ok(`Starting hub-worker on :${PORT} (wrangler dev --local)...`);
info(`Build: ${BUILD_ENTRY}`);
info(`CWD:   ${HUB_DIR}`);

const proc = Bun.spawn(
  [
    'bunx',
    'wrangler',
    'dev',
    '--local',
    '--port',
    String(PORT),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    './.wrangler',
  ],
  {
    cwd: HUB_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      // 🔴 Explicitly unset so wrangler never falls through to remote mode.
      CLOUDFLARE_API_TOKEN: '',
      CLOUDFLARE_ACCOUNT_ID: '',
    },
  },
);

const code = await proc.exited;
if (code !== 0) {
  error(`hub-worker exited with code ${code}`);
  info('Common issues:');
  info('  • Build is stale — rebuild with `bun moon run hub:build`');
  info('  • Port conflict — check `bun herdr:list` for other services on :' + String(PORT));
  info('  • Missing wrangler — run `bun install` in the repo root');
  process.exit(code);
}
