// scripts/src/lib/ops/preview.ts
//
// Aikami Client Preview & Launch — build, dev server, Tauri, or Chromium
// with PixiJS DevTools extension loaded and persistent auth profile.
//
// Usage:
//   bun run scripts -- preview                           # dev + devtools (default)
//   bun run scripts -- preview --build                   # build + vite preview
//   bun run scripts -- preview --tauri                   # build + tauri launch
//   bun run scripts -- preview --mode staging            # staging mode
//   bun run scripts -- preview --no-devtools             # skip devtools
//   bun run scripts -- preview --update-devtools         # force devtools re-download
//   bun run scripts -- preview --no-dev                  # skip tmux dev server
//
// CLI flags:
//   --build               Build client + vite preview server
//   --tauri               Build client + cargo + run Tauri desktop
//   --mode <mode>         emulator (default), staging, production
//   --dev                 (default) Ensure client running in tmux
//   --no-dev              Skip tmux dev server (use with --build)
//   --devtools            (default, non-tauri) Launch Chromium with PixiJS DevTools
//   --no-devtools         Skip Chromium/devtools launch
//   --update-devtools     Force re-download PixiJS DevTools extension
//   --force               Force rebuild clean

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { EMULATOR_PORTS, PORTS } from '@aikami/constants';
import { buildSessionName, sessionExists, startServices, waitForReady } from '../tmux/session.ts';
import { ensureDevtools, getDevtoolsPath, updateDevtools } from './pixi_devtools.ts';

// ── CLI colors ─────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const log = (prefix: string, color: string, message: string): void => {
  console.log(`${color}${BOLD}[${prefix}]${RESET} ${message}`);
};
const info = (m: string) => log('info', BLUE, m);
const ok = (m: string) => log('ok', GREEN, m);
const warn = (m: string) => log('warn', YELLOW, m);
const error = (m: string) => log('error', RED, m);

// ── Types ──────────────────────────────────────────────────────────────────

type AikamiMode = 'emulator' | 'staging' | 'production';

type PreviewOptions = {
  build: boolean;
  tauri: boolean;
  mode: AikamiMode;
  dev: boolean;
  devtools: boolean;
  updateDevtools: boolean;
  force: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLIENT_DIR = resolve(ROOT, 'apps/frontend/client');
const BUILD_DIR = resolve(CLIENT_DIR, 'build');
const SVELTE_KIT_DIR = resolve(CLIENT_DIR, '.svelte-kit');
const PREVIEW_PORT = EMULATOR_PORTS.client; // vite preview always on 5274
const STARTUP_TIMEOUT_MS = 15_000;
const CHROMIUM_PROFILE_DIR = resolve(homedir(), '.aikami-chromium-profile');

// ── Helpers ────────────────────────────────────────────────────────────────

const cleanDir = (dirPath: string, label: string): void => {
  if (existsSync(dirPath)) {
    info(`Cleaning ${label}…`);
    rmSync(dirPath, { recursive: true, force: true });
  }
};

const spawn = (cmd: string[], label: string): Promise<number> => {
  return new Promise((resolvePromise) => {
    info(`Running: ${cmd.join(' ')}`);
    const proc = Bun.spawn({
      cmd,
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    proc.exited.then((code) => {
      if (code === 0) {
        ok(`${label} — exit 0`);
      } else {
        error(`${label} — exit ${code}`);
      }
      resolvePromise(code);
    });
  });
};

const hasFlag = (args: string[], flag: string): boolean => args.includes(flag);

const parseArg = (args: string[], flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
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

const getClientUrl = (mode: AikamiMode): string =>
  `http://localhost:${getClientPort(mode)}/dev/sandbox`;

// ── Arg parsing ────────────────────────────────────────────────────────────

const parseOptions = (args: string[]): PreviewOptions => {
  const build = hasFlag(args, '--build');
  const tauri = hasFlag(args, '--tauri');
  const noDev = hasFlag(args, '--no-dev');
  const noDevtools = hasFlag(args, '--no-devtools');
  const updateDevtoolsFlag = hasFlag(args, '--update-devtools');
  const force = hasFlag(args, '--force');

  const rawMode = parseArg(args, '--mode');
  const mode = parseMode(rawMode);

  // Defaults:
  //   --dev is default (unless --no-dev or --build-or-tauri overrides it)
  //   --devtools is default (unless --tauri or --no-devtools)
  const dev = !noDev;
  const devtools = !tauri && !noDevtools;

  return { build, tauri, mode, dev, devtools, updateDevtools: updateDevtoolsFlag, force };
};

// ── Tmux dev server ────────────────────────────────────────────────────────

const ensureDevServer = async (mode: AikamiMode): Promise<void> => {
  const sessionName = buildSessionName(mode);

  if (!(await sessionExists(sessionName))) {
    info(`Starting ${mode} tmux session with client…`);
    await startServices({ mode, services: ['emulators', 'client'] });
    await waitForReady({ services: ['emulators'], mode }, 60_000);
  } else {
    // Ensure client window exists
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
  const code = await spawn(buildArgs, `client:build (${mode})`);
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

const launchTauri = async (mode: AikamiMode, force: boolean, devRoute: boolean): Promise<void> => {
  // Ensure LPC assets are available before building for Tauri.
  // The download_lpc_assets script puts them in src/lib/assets/lpc/,
  // but the app references them at /lpc/ URLs (served from static/).
  // We need them in static/lpc/ so Vite copies them into the build output.
  const lpcSrcDir = resolve(CLIENT_DIR, 'src/lib/assets/lpc/body/male');
  const lpcStaticDir = resolve(CLIENT_DIR, 'static/lpc/body/male');
  const lpcHasAssets = existsSync(lpcStaticDir) && existsSync(resolve(lpcStaticDir, 'walk.png'));
  const lpcHasDownloaded = existsSync(lpcSrcDir) && existsSync(resolve(lpcSrcDir, 'walk.png'));

  if (!lpcHasAssets && !lpcHasDownloaded) {
    warn('LPC assets not found — downloading…');
    const lpcCode = await spawn(
      ['bun', 'run', 'scripts/src/lib/ops/download_lpc_assets.ts', '--mode', mode],
      'download_lpc_assets',
    );
    if (lpcCode !== 0) {
      warn('LPC asset download failed — sprites may not render in Tauri');
    } else {
      ok('LPC assets downloaded');
    }
  }

  // Copy from src/lib/assets/lpc/ to static/lpc/ if needed
  if (!lpcHasAssets && existsSync(resolve(CLIENT_DIR, 'src/lib/assets/lpc'))) {
    info('Copying LPC assets to static/lpc/ for build…');
    const copyCode = await spawn(
      ['cp', '-r', resolve(CLIENT_DIR, 'src/lib/assets/lpc'), resolve(CLIENT_DIR, 'static/lpc')],
      'copy_lpc_to_static',
    );
    if (copyCode === 0) {
      ok('LPC assets copied to static/');
    }
  }

  info('Building client for Tauri…');

  // Build the client (emulator mode is typical for Tauri dev)
  const buildOk = await buildClient(mode, force);
  if (!buildOk) {
    error('Client build failed. Aborting Tauri launch.');
    process.exit(1);
  }

  info('Building and launching Tauri desktop app…');

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

  ok('Tauri built successfully — launching…');

  const tauriCmd: string[] = [resolve(CLIENT_DIR, 'src-tauri/target/debug/aikami')];
  if (devRoute) {
    tauriCmd.push('--route', '/dev/sandbox');
  }

  const tauriProc = Bun.spawn({
    cmd: tauriCmd,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  await tauriProc.exited;
};

// ── Chromium launch ────────────────────────────────────────────────────────

const launchChromium = async (mode: AikamiMode): Promise<void> => {
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

  const clientUrl = getClientUrl(mode);

  const chromiumArgs: string[] = [
    'chromium',
    `--user-data-dir=${CHROMIUM_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--no-pings',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
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
    info('Auth & settings persisted in ~/.aikami-chromium-profile');
  }

  const proc = Bun.spawn(chromiumArgs, {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  await proc.exited;
};

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = parseOptions(args);

console.log(`\n${BOLD}Aikami Client Preview${RESET}\n`);
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
  if (!opts.build && !opts.tauri && !opts.dev && !opts.devtools) {
    process.exit(result ? 0 : 1);
  }
}

// ── Tauri path ────────────────────────────────────
if (opts.tauri) {
  // In Tauri mode, dev server runs embedded — no tmux or chromium needed
  // --dev flag controls whether to open at /dev/sandbox route
  await launchTauri(opts.mode, opts.force, opts.dev);
  ok('Tauri exited.');
  process.exit(0);
}

// ── Dev server (tmux) ─────────────────────────────
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
  await launchChromium(opts.mode);
} else if (!opts.build) {
  // If not building and not launching browser, just print the URL
  const clientUrl = getClientUrl(opts.mode);
  ok(`Client running at ${clientUrl}`);
}

ok('Done.');
