// scripts/src/lib/ops/preview_site.ts
//
// Aikami Site Preview — ensures the site dev server is running in herdr,
// then launches Chromium for visual testing.
//
// Usage:
//   bun run scripts -- preview-site                  # ensure site dev server + chromium
//
// The site dev server is managed via herdr. If the site tab isn't running
// in the current aikami workspace, it will be started automatically.

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PORTS } from '@aikami/constants';
import { c, error, info, ok } from '../cli_utils.ts';
import { resolveAikamiMode } from '../env/mode';
import type { AikamiMode } from '../herdr/session.ts';
import { findWorkspace, isPortReady, resolveSessionName, startServices } from '../herdr/session.ts';

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '../../../..');
const CHROMIUM_PROFILE_DIR = resolve(ROOT, 'dist/tmp/.chromium-profile-site');

// ── Helpers ────────────────────────────────────────────────────────────────

const waitForPort = async (port: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortReady(port)) {
      ok(`Site ready at http://localhost:${port}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

// ── Ensure site dev server ─────────────────────────────────────────────────

const ensureSite = async (mode: AikamiMode): Promise<number> => {
  const wsName = resolveSessionName(mode);
  const sitePort = PORTS[mode].site;
  const wsId = await findWorkspace(wsName);

  // Check if site is already running and responding
  if (wsId && (await isPortReady(sitePort))) {
    ok(`Site dev server already running on port ${sitePort}`);
    return sitePort;
  }

  info(`Starting site dev server in herdr workspace ${wsName}…`);
  await startServices({ mode, services: ['site'], projectRoot: ROOT });

  const isReady = await waitForPort(sitePort, 30_000);
  if (!isReady) {
    error('Site dev server did not respond within 30s');
    process.exit(1);
  }

  return sitePort;
};

// ── Chromium launch ────────────────────────────────────────────────────────

const launchChromium = async (port: number) => {
  // Wipe stale profile directory to clear locks and cached extension state
  rmSync(CHROMIUM_PROFILE_DIR, { recursive: true, force: true });
  mkdirSync(CHROMIUM_PROFILE_DIR, { recursive: true });

  const targetUrl = `http://localhost:${port}`;

  info(`Launching Chromium → ${targetUrl}`);

  const proc = Bun.spawn(
    [
      'chromium-unwrapped', // Bypasses flake.nix wrapper that forces --enable-automation
      `--user-data-dir=${CHROMIUM_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--test-type', // Silences "unsupported command-line flag" warning bars
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--no-pings',
      '--window-size=1440,900',
      `--app=${targetUrl}`,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );

  await proc.exited;
};

// ── Main ───────────────────────────────────────────────────────────────────

const mode: AikamiMode = resolveAikamiMode();

console.log(`\n${c.bold}Aikami Site Preview${c.reset}\n`);
info(`Mode: ${mode}`);

const port = await ensureSite(mode);
await launchChromium(port);

ok('Done.');
