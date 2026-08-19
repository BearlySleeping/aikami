// scripts/src/lib/ops/preview_hub.ts
//
// Aikami Hub Preview — ensures the hub dev server is running in herdr,
// then launches Chromium for visual testing.
//
// Usage:
//   bun run scripts -- preview-hub                  # ensure hub dev server + chromium
//
// The hub dev server is managed via herdr. If the hub tab isn't running
// in the current aikami workspace, it will be started automatically.

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PORTS } from '@aikami/constants';
import { findChromiumExecutable } from '../chromium.ts';
import { c, error, info, ok } from '../cli_utils.ts';
import { resolveAikamiMode } from '../env/mode';
import type { AikamiMode } from '../herdr/session.ts';
import { findWorkspace, isPortReady, resolveSessionName, startServices } from '../herdr/session.ts';

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '../../../..');
const CHROMIUM_PROFILE_DIR = resolve(ROOT, 'dist/tmp/.chromium-profile-hub');

// ── Helpers ────────────────────────────────────────────────────────────────

const waitForPort = async (portNum: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortReady(portNum)) {
      ok(`Hub ready at http://localhost:${portNum}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

// ── Ensure hub dev server ─────────────────────────────────────────────────

const ensureHub = async (aikamiMode: AikamiMode): Promise<number> => {
  const wsName = resolveSessionName(aikamiMode);
  const hubPort = PORTS[aikamiMode].hub;
  const wsId = await findWorkspace(wsName);

  // Check if hub is already running and responding
  if (wsId && (await isPortReady(hubPort))) {
    ok(`Hub dev server already running on port ${hubPort}`);
    return hubPort;
  }

  info(`Starting hub dev server in herdr workspace ${wsName}…`);
  await startServices({ mode, services: ['hub'], projectRoot: ROOT });

  const isReady = await waitForPort(hubPort, 30_000);
  if (!isReady) {
    error('Hub dev server did not respond within 30s');
    process.exit(1);
  }

  return hubPort;
};

// ── Chromium launch ────────────────────────────────────────────────────────

const launchChromium = async (portNum: number) => {
  // Wipe stale profile directory to clear locks and cached extension state
  rmSync(CHROMIUM_PROFILE_DIR, { recursive: true, force: true });
  mkdirSync(CHROMIUM_PROFILE_DIR, { recursive: true });

  const targetUrl = `http://localhost:${portNum}`;

  // Prefer chromium-unwrapped (bypasses the flake.nix wrapper that forces
  // --enable-automation) where it exists; falls back to a real browser
  // install elsewhere, including Windows (see scripts/src/lib/chromium.ts).
  const chromiumExe = findChromiumExecutable([
    'chromium-unwrapped',
    'chromium',
    'chromium-browser',
    'google-chrome',
  ]);
  if (!chromiumExe) {
    error(
      'Chromium not found. Install chromium or set CHROMIUM_EXECUTABLE env var to the path of your chromium binary.',
    );
    process.exit(1);
  }

  info(`Launching Chromium → ${targetUrl}`);

  const chromiumArgs = [
    chromiumExe,
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
  ];

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(chromiumArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) {
    error(`Failed to launch ${chromiumExe}: ${e}`);
    error(
      'The resolved browser executable may be missing or incomplete (e.g. a standalone .exe copied without its adjacent .dll/resource files). ' +
        'Set CHROMIUM_EXECUTABLE to a full, working Chrome/Chromium/Edge install path.',
    );
    process.exit(1);
  }

  await proc.exited;
};

// ── Main ───────────────────────────────────────────────────────────────────

const mode: AikamiMode = resolveAikamiMode();

console.log(`\n${c.bold}Aikami Hub Preview${c.reset}\n`);
info(`Mode: ${mode}`);

const port = await ensureHub(mode);
await launchChromium(port);

ok('Done.');
