// scripts/src/lib/ops/preview_client.ts
//
// Aikami Client Preview & Launch — build, dev server, Tauri, or Chromium
// with PixiJS DevTools extension loaded and persistent auth profile.
//
// Usage:
//   bun run scripts -- preview                           # dev + devtools (default)
//   bun run scripts -- preview --build                   # build + vite preview
//   bun run scripts -- preview --tauri                   # build + tauri launch
//   bun run scripts -- preview --tauri-dev               # herdr dev server + `tauri dev` (hot reload, no client rebuild)
//   bun run scripts -- preview --mode staging --live     # live staging (no local server)
//   bun run scripts -- preview --mode production --live  # live production
//   bun run scripts -- preview --no-devtools             # skip devtools
//   bun run scripts -- preview --update-devtools         # force devtools re-download
//   bun run scripts -- preview --no-dev                  # skip herdr dev server
//
// CLI flags:
//   --build               Build client + vite preview server
//   --tauri               Build client + cargo + run Tauri desktop (embedded assets)
//   --tauri-dev           Run herdr dev server + `tauri dev` pointed at it (no client rebuild)
//   --mode <mode>         emulator (default), staging, production
//   --live                Launch against deployed live URL (staging/production only)
//   --dev                 (default) Ensure client running in herdr
//   --no-dev              Skip herdr dev server (use with --build)
//   --devtools            (default, non-tauri) Launch Chromium with PixiJS DevTools
//   --no-devtools         Skip Chromium/devtools launch
//   --update-devtools     Force re-download PixiJS DevTools extension
//   --force               Force rebuild clean

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMULATOR_PORTS, PORTS } from '@aikami/constants';
import { findChromiumExecutable } from '../chromium.ts';
import { c, error, hasFlag, info, ok, parseArg, spawnLabeled, warn } from '../cli_utils.ts';
import {
  buildSessionName,
  startServices,
  waitForReady,
  workspaceExists,
} from '../herdr/session.ts';
import { ensureDevtools, getDevtoolsPath, updateDevtools } from './pixi_devtools.ts';

// ── Types ──────────────────────────────────────────────────────────────────

type AikamiMode = 'emulator' | 'staging' | 'production';

type PreviewOptions = {
  build: boolean;
  tauri: boolean;
  tauriDev: boolean;
  mode: AikamiMode;
  live: boolean;
  dev: boolean;
  devtools: boolean;
  updateDevtools: boolean;
  force: boolean;
  softwareGl: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLIENT_DIR = resolve(ROOT, 'apps/frontend/client');
const BUILD_DIR = resolve(CLIENT_DIR, 'build');
const SVELTE_KIT_DIR = resolve(CLIENT_DIR, '.svelte-kit');
const PREVIEW_PORT = EMULATOR_PORTS.client; // vite preview always on 5274
const STARTUP_TIMEOUT_MS = 15_000;
const CHROMIUM_PROFILE_DIR = resolve(ROOT, 'dist/tmp/.chromium-profile');

// ── Helpers ────────────────────────────────────────────────────────────────

const cleanDir = (dirPath: string, label: string): void => {
  if (existsSync(dirPath)) {
    info(`Cleaning ${label}…`);
    rmSync(dirPath, { recursive: true, force: true });
  }
};

const parseMode = (raw: string | undefined): AikamiMode => {
  if (raw === 'staging' || raw === 'production' || raw === 'emulator') {
    return raw;
  }
  if (raw) {
    warn(`Unknown mode "${raw}" — falling back to emulator`);
  }
  return 'emulator';
};

const getClientPort = (mode: AikamiMode): number => PORTS[mode].client;

// ── Live URLs ──────────────────────────────────────────────────────────────

const LIVE_URLS: Record<'staging' | 'production', string> = {
  staging: 'https://aikami.stg.bearlysleeping.com',
  production: 'https://aikami.bearlysleeping.com',
} as const;

const getLiveUrl = (mode: AikamiMode): string | null => {
  if (mode === 'emulator') {
    return null;
  }
  return `${LIVE_URLS[mode]}/dev/sandbox`;
};

const getClientUrl = (mode: AikamiMode, live = false): string => {
  if (live) {
    const liveUrl = getLiveUrl(mode);
    if (liveUrl) {
      return liveUrl;
    }
  }
  return `http://localhost:${getClientPort(mode)}/dev/sandbox`;
};

// ── Arg parsing ────────────────────────────────────────────────────────────

const parseOptions = (args: string[]): PreviewOptions => {
  const build = hasFlag(args, 'build');
  const tauri = hasFlag(args, 'tauri');
  const tauriDev = hasFlag(args, 'tauri-dev') || hasFlag(args, 'tauri-dev-server');
  const live = hasFlag(args, 'live');
  const noDev = hasFlag(args, 'no-dev');
  const noDevtools = hasFlag(args, 'no-devtools');
  const updateDevtoolsFlag = hasFlag(args, 'update-devtools');
  const force = hasFlag(args, 'force');
  const softwareGl = hasFlag(args, 'software-gl') || hasFlag(args, 'sw-gl');

  const rawMode = parseArg(args, '--mode');
  const mode = parseMode(rawMode);

  // Defaults:
  //   --dev is default (unless --no-dev, --live, or --build overrides it)
  //   --devtools is default (unless --tauri/--tauri-dev or --no-devtools)
  //   --live implies --no-dev (no herdr server needed for deployed URLs)
  //   --build implies --no-dev (vite preview runs instead)
  //   --tauri-dev implies --dev (herdr dev server is the point)
  const dev = (tauriDev || !noDev) && !live && !build;
  const devtools = !tauri && !tauriDev && !noDevtools;

  return {
    build,
    tauri,
    tauriDev,
    mode,
    live,
    dev,
    devtools,
    updateDevtools: updateDevtoolsFlag,
    force,
    softwareGl,
  };
};

// ── Herdr dev server ────────────────────────────────────────────────────────

const ensureDevServer = async (mode: AikamiMode): Promise<void> => {
  const wsName = buildSessionName(mode);

  // Emulator: firebase + client. Staging/production: client only (backend is deployed).
  const services: ('firebase' | 'client')[] =
    mode === 'emulator' ? ['firebase', 'client'] : ['client'];

  if (!(await workspaceExists(wsName))) {
    info(`Starting ${mode} herdr workspace with ${services.join(' + ')}…`);
    await startServices({ mode, services });
    if (mode === 'emulator') {
      await waitForReady({ services: ['firebase'], mode }, 60_000);
    }
  } else {
    // Ensure client tab exists
    await startServices({ mode, services: ['client'] });
  }

  // Wait for client to be ready
  const clientPort = getClientPort(mode);
  info(`Waiting for client on port ${clientPort}…`);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${clientPort}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status === 404) {
        ok(`Client ready on port ${clientPort}`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  warn(`Client did not respond within ${STARTUP_TIMEOUT_MS}ms — continuing anyway`);
};

// ── Build ──────────────────────────────────────────────────────────────────

const buildClient = async (mode: AikamiMode, force: boolean): Promise<boolean> => {
  // Clean stale artifacts
  cleanDir(BUILD_DIR, 'build/');
  cleanDir(SVELTE_KIT_DIR, '.svelte-kit/');

  const buildArgs = [
    'bun',
    'run',
    'moon',
    'run',
    'client:build',
    ...(force ? ['--force'] : []),
    '--',
    '--mode',
    mode,
  ];
  const code = await spawnLabeled(buildArgs, `client:build (${mode})`, { cwd: ROOT });
  return code === 0;
};

// ── Vite preview ───────────────────────────────────────────────────────────

const startVitePreview = async (): Promise<void> => {
  info(`Starting vite preview server on port ${PREVIEW_PORT}…`);

  const previewProc = Bun.spawn({
    cmd: ['bun', 'run', 'moon', 'run', 'client:preview', '--', '--mode', 'emulator'],
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  // Wait for server to be ready
  const previewUrl = `http://localhost:${PREVIEW_PORT}/dev/sandbox`;
  const started = await new Promise<boolean>((resolvePromise) => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const check = async () => {
      if (Date.now() > deadline) {
        warn(`Preview server did not respond within ${STARTUP_TIMEOUT_MS}ms`);
        resolvePromise(false);
        return;
      }
      try {
        const res = await fetch(previewUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok || res.status === 404) {
          ok(`Preview server ready at ${previewUrl}`);
          resolvePromise(true);
          return;
        }
      } catch {}
      setTimeout(check, 500);
    };
    check();
  });

  if (!started) {
    error('Preview server failed to start');
    process.exit(1);
  }

  ok('Vite preview server running. Press Ctrl+C to stop.');
  await previewProc.exited;
};

// ── Tauri launch ───────────────────────────────────────────────────────────

/**
 * Ensures the LPC asset tree exists under static/game-data/lpc/. Downloads
 * it when missing (shared by the bundled and dev-server Tauri launch paths).
 */
const ensureLpcAssets = async (mode: AikamiMode): Promise<void> => {
  const lpcStaticDir = resolve(CLIENT_DIR, 'static/game-data/lpc');
  // Validate a required LPC asset file (AC-1 canonical path) rather than only
  // the body directory — an empty or partial static/game-data/lpc tree must
  // leave lpcHasAssets false so the download step runs.
  const lpcHasAssets = existsSync(resolve(lpcStaticDir, 'body', 'bodies_male.walk.webp'));

  if (!lpcHasAssets) {
    warn('LPC assets not found — downloading…');
    const lpcCode = await spawnLabeled(
      ['bun', 'run', 'scripts/src/lib/ops/download_lpc_assets.ts', '--mode', mode],
      'download_lpc_assets',
      { cwd: ROOT },
    );
    if (lpcCode !== 0) {
      warn('LPC asset download failed — sprites may not render in Tauri');
    } else {
      ok('LPC assets downloaded to static/game-data/lpc/');
    }
  }
};

/**
 * WebKitGTK environment overrides that avoid wedging the Intel i915 GPU on
 * hybrid-graphics laptops (screen freeze + audio-alive hang). See the
 * 2026-08-03 freeze incident analysis.
 *
 * `WEBKIT_DISABLE_DMABUF_RENDERER` is a dead end on WebKitGTK ≥ 2.44 (X11/WPE
 * renderers were removed in favor of DMA-BUF); the supported workaround that
 * keeps compositing while avoiding the DMA-BUF import path is
 * `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`. With `--software-gl`, force the whole
 * webview onto llvmpipe (fully contained, safe for correctness/UI work).
 */
const getWebkitGtkSafeEnv = (softwareGl: boolean): Record<string, string> => ({
  WEBKIT_DMABUF_RENDERER_FORCE_SHM: '1',
  ...(softwareGl ? { LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' } : {}),
});

const launchTauri = async (
  mode: AikamiMode,
  force: boolean,
  devRoute: boolean,
  softwareGl: boolean,
): Promise<void> => {
  await ensureLpcAssets(mode);

  info('Building client for Tauri…');

  // Build the client (emulator mode is typical for Tauri dev)
  const buildOk = await buildClient(mode, force);
  if (!buildOk) {
    error('Client build failed. Aborting Tauri launch.');
    process.exit(1);
  }

  info('Building and launching Tauri desktop app…');

  const cargoBuild = Bun.spawn({
    // Explicit custom-protocol: the binary must embed frontendDist (prod mode).
    cmd: ['cargo', 'build', '--features', 'tauri/custom-protocol'],
    cwd: resolve(CLIENT_DIR, 'src-tauri'),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const cargoCode = await cargoBuild.exited;
  if (cargoCode !== 0) {
    error(`Cargo build failed with exit code ${cargoCode}`);
    process.exit(cargoCode);
  }

  ok('Tauri built successfully — launching…');

  const tauriCmd: string[] = [resolve(CLIENT_DIR, 'src-tauri/target/debug/aikami')];
  if (devRoute) {
    tauriCmd.push('--route', '/dev/sandbox');
  }

  const tauriProc = Bun.spawn({
    cmd: tauriCmd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...getWebkitGtkSafeEnv(softwareGl),
    },
  });

  await tauriProc.exited;
};

/**
 * Tauri dev-server mode — the client is served by the herdr dev server
 * (Vite with HMR) and the Tauri window loads that URL instead of the
 * embedded production bundle.
 *
 * No SvelteKit rebuild is needed for frontend changes (herdr hot-reloads)
 * and the app logs flow through `herdr_session read client`.
 *
 * Compiles the Rust binary WITHOUT `tauri/custom-protocol` so the runtime
 * uses `build.devUrl` (tauri.conf.json → http://localhost:<client port>),
 * then launches it directly — same effect as `tauri dev --no-dev-server-wait`
 * but without the CLI starting its own frontend server (herdr owns the port).
 */
const launchTauriDev = async (
  mode: AikamiMode,
  devRoute: boolean,
  softwareGl: boolean,
): Promise<void> => {
  await ensureLpcAssets(mode);

  // Start (or reuse) the herdr dev workspace: firebase + client (emulator) or
  // client only (staging/production). The client port must match
  // tauri.conf.json build.devUrl (emulator → http://localhost:5274).
  await ensureDevServer(mode);
  const clientPort = getClientPort(mode);
  const devUrl = `http://localhost:${clientPort}`;
  info(`Tauri will load the herdr dev server at ${devUrl}`);

  info('Compiling Tauri (dev mode — frontend served by herdr)…');
  const cargoBuild = Bun.spawn({
    cmd: ['cargo', 'build'],
    cwd: resolve(CLIENT_DIR, 'src-tauri'),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const cargoCode = await cargoBuild.exited;
  if (cargoCode !== 0) {
    error(`Cargo build failed with exit code ${cargoCode}`);
    process.exit(cargoCode);
  }

  ok(`Tauri built — launching against ${devUrl}…`);

  const tauriCmd: string[] = [resolve(CLIENT_DIR, 'src-tauri/target/debug/aikami')];
  if (devRoute) {
    tauriCmd.push('--route', '/dev/sandbox');
  }
  const tauriProc = Bun.spawn({
    cmd: tauriCmd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...getWebkitGtkSafeEnv(softwareGl),
    },
  });

  await tauriProc.exited;
};

// ── Chromium launch ────────────────────────────────────────────────────────

const launchChromium = async (mode: AikamiMode, live = false): Promise<void> => {
  // Ensure devtools are installed
  let devtoolsPath: string | null = getDevtoolsPath();
  if (!devtoolsPath) {
    info('PixiJS DevTools not found — downloading…');
    devtoolsPath = ensureDevtools();
  }

  if (!devtoolsPath) {
    warn('PixiJS DevTools could not be loaded. Launching Chromium without extension.');
  }

  // Ensure persistent profile directory exists
  mkdirSync(CHROMIUM_PROFILE_DIR, { recursive: true });

  const clientUrl = getClientUrl(mode, live);

  // Find chromium executable
  const chromiumExe = findChromiumExecutable();
  if (!chromiumExe) {
    error(
      'Chromium not found. Install chromium or set CHROMIUM_EXECUTABLE env var to the path of your chromium binary.',
    );
    process.exit(1);
  }

  const chromiumArgs: string[] = [
    chromiumExe,
    `--user-data-dir=${CHROMIUM_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--no-pings',
    ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
    '--disable-gcm',
    '--disable-push-notifications',
    '--disable-features=PushMessaging,GCM',
    '--test-type', // Silences "unsupported command-line flag" warning bars
  ];

  // Load extension if available
  if (devtoolsPath) {
    chromiumArgs.push(`--load-extension=${devtoolsPath}`);
    chromiumArgs.push(`--disable-extensions-except=${devtoolsPath}`);
    ok(`PixiJS DevTools loaded from ${devtoolsPath}`);
  }

  // Open the client URL (not about:blank — we want to land on the app)
  chromiumArgs.push(clientUrl);

  info(`Launching Chromium → ${clientUrl}`);
  if (devtoolsPath) {
    info(`Auth & settings persisted in ${CHROMIUM_PROFILE_DIR}`);
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(chromiumArgs, {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (e) {
    error(`Failed to launch ${chromiumExe}: ${e}`);
    error(
      'The resolved browser executable may be missing or incomplete (e.g. a standalone .exe copied without its adjacent .dll/resource files). ' +
        'Set CHROMIUM_EXECUTABLE to a full, working Chrome/Chromium/Edge install path.',
    );
    process.exit(1);
  }

  proc.exited.then((exitCode) => {
    if (exitCode !== 0) {
      warn(`Chromium exited with code ${exitCode}`);
    }
  });

  await proc.exited;
};

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = parseOptions(args);

console.log(`\n${c.bold}Aikami Client Preview${c.reset}\n`);
info(`Mode: ${opts.mode}`);

// Handle --update-devtools (can be combined with other flags or standalone)
if (opts.updateDevtools) {
  info('Force-updating PixiJS DevTools…');
  const result = updateDevtools();
  if (result) {
    ok(`PixiJS DevTools updated: ${result}`);
  } else {
    error('Failed to update PixiJS DevTools');
  }
  // If --update-devtools was the only action, exit
  if (!opts.build && !opts.tauri && !opts.tauriDev && !opts.live && !opts.dev && !opts.devtools) {
    process.exit(result ? 0 : 1);
  }
}

// ── Tauri path ────────────────────────────────────
if (opts.tauriDev) {
  // Dev-server mode: herdr serves the client, tauri dev loads it (no client rebuild).
  await launchTauriDev(opts.mode, opts.dev, opts.softwareGl);
  ok('Tauri dev exited.');
  process.exit(0);
}

// ── Tauri path (embedded build) ────────────────────
if (opts.tauri) {
  // In Tauri mode, dev server runs embedded — no herdr or chromium needed
  // --dev flag controls whether to open at /dev/sandbox route
  await launchTauri(opts.mode, opts.force, opts.dev, opts.softwareGl);
  ok('Tauri exited.');
  process.exit(0);
}

// ── Live mode — skip herdr, launch Chromium against deployed URL ──
if (opts.live) {
  const liveUrl = getLiveUrl(opts.mode);
  if (!liveUrl) {
    error(`--live only works with staging or production mode (got: ${opts.mode})`);
    process.exit(1);
  }
  ok(`Targeting live deployment: ${liveUrl}`);
  await launchChromium(opts.mode, true);
  ok('Done.');
  process.exit(0);
}

// ── Dev server (herdr) ─────────────────────────────
if (opts.dev) {
  await ensureDevServer(opts.mode);
}

// ── Build path ────────────────────────────────────
if (opts.build) {
  const buildOk = await buildClient(opts.mode, opts.force);
  if (!buildOk) {
    error('Build failed. Aborting.');
    process.exit(1);
  }
  await startVitePreview();
  process.exit(0);
}

// ── Chromium with devtools ────────────────────────
if (opts.devtools) {
  await launchChromium(opts.mode, false);
} else if (!opts.build) {
  // If not building and not launching browser, just print the URL
  const clientUrl = getClientUrl(opts.mode);
  ok(`Client running at ${clientUrl}`);
}

ok('Done.');
