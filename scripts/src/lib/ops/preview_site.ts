// scripts/src/lib/ops/preview_site.ts
//
// Aikami Site Preview & Launch — build, dev server, preview server, and Chromium.
//
// Usage:
//   bun run scripts -- preview-site                           # build + preview + chromium
//   bun run scripts -- preview-site --dev                     # live dev server + chromium (HMR)
//   bun run scripts -- preview-site --no-build                # skip build, preview existing dist/
//   bun run scripts -- preview-site --no-chromium             # server only, no browser
//   bun run scripts -- preview-site --mode staging            # staging mode
//
// CLI flags:
//   --mode <mode>         emulator (default), staging, production
//   --dev                 Use live dev server (hot reload) instead of build+preview
//   --no-build            Skip build step (still uses preview server from dist/)
//   --no-chromium         Skip Chromium launch

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PORTS } from '@aikami/constants';

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
  devMode: boolean;
  build: boolean;
  chromium: boolean;
  mode: AikamiMode;
};

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '../../../..');
const SITE_DIR = resolve(ROOT, 'apps/frontend/site');
const DIST_DIR = resolve(SITE_DIR, 'dist');
const SITE_PORT = PORTS.emulator.site;
const CHROMIUM_PROFILE_DIR = resolve(ROOT, 'dist/tmp/.chromium-profile-site');

// ── Helpers ────────────────────────────────────────────────────────────────

const cleanDir = (dirPath: string, label: string): void => {
  if (existsSync(dirPath)) {
    info(`Cleaning ${label}…`);
    rmSync(dirPath, { recursive: true, force: true });
  }
};

const spawn = (cmd: string[], cwd: string, label: string): Promise<number> => {
  return new Promise((resolvePromise) => {
    info(`Running: ${cmd.join(' ')}`);
    const proc = Bun.spawn({
      cmd,
      cwd,
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

const waitForPort = async (port: number, timeoutMs: number, label: string): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        ok(`${label} ready at http://localhost:${port}`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  warn(`${label} did not respond within ${timeoutMs}ms`);
  return false;
};

// ── Arg parsing ────────────────────────────────────────────────────────────

const parseOptions = (args: string[]): PreviewOptions => {
  const devMode = hasFlag(args, '--dev');
  const build = !devMode && !hasFlag(args, '--no-build');
  const chromium = !hasFlag(args, '--no-chromium');
  const mode = parseMode(parseArg(args, '--mode'));
  return { devMode, build, chromium, mode };
};

// ── Build ──────────────────────────────────────────────────────────────────

const buildSite = async (mode: AikamiMode): Promise<boolean> => {
  cleanDir(DIST_DIR, 'dist/');

  const code = await spawn(
    ['bun', 'run', 'moon', 'run', 'site:build', '--', '--mode', mode],
    ROOT,
    `site:build (${mode})`,
  );
  return code === 0;
};

// ── Dev server ─────────────────────────────────────────────────────────────

const startDevServer = (mode: AikamiMode): { proc: { kill: () => void }; ready: Promise<boolean> } => {
  info(`Starting dev server on port ${SITE_PORT} (${mode} mode)…`);

  const cmd = mode === 'emulator'
    ? ['bun', 'run', 'dev']
    : ['bun', 'run', `dev:${mode}`];

  const proc = Bun.spawn({
    cmd,
    cwd: SITE_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  return { proc, ready: waitForPort(SITE_PORT, 15_000, 'Dev server') };
};

// ── Preview server ─────────────────────────────────────────────────────────

const startPreview = (): { proc: { kill: () => void }; ready: Promise<boolean> } => {
  info(`Starting astro preview on port ${SITE_PORT}…`);

  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'preview', '--port', String(SITE_PORT)],
    cwd: SITE_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  return { proc, ready: waitForPort(SITE_PORT, 15_000, 'Preview server') };
};

// ── Chromium launch ────────────────────────────────────────────────────────

const launchChromium = async (): Promise<void> => {
  mkdirSync(CHROMIUM_PROFILE_DIR, { recursive: true });

  const targetUrl = `http://localhost:${SITE_PORT}`;

  const proc = Bun.spawn(
    [
      'chromium',
      `--user-data-dir=${CHROMIUM_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--no-pings',
      '--window-size=1440,900',
      `--app=${targetUrl}`,
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  await proc.exited;
};

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = parseOptions(args);

console.log(`\n${BOLD}Aikami Site Preview${RESET}\n`);
info(`Mode: ${opts.mode}`);

if (opts.devMode) {
  // Live dev server with HMR
  info('Using live dev server (HMR)');
  const dev = startDevServer(opts.mode);
  const isReady = await dev.ready;
  if (!isReady) {
    error('Dev server failed to start');
    dev.proc.kill();
    process.exit(1);
  }

  if (opts.chromium) {
    info('Launching Chromium…');
    await launchChromium();
  }
} else {
  // Build → preview path
  if (opts.build) {
    const ok_ = await buildSite(opts.mode);
    if (!ok_) {
      error('Build failed. Aborting.');
      process.exit(1);
    }
  } else {
    info('Skipping build (--no-build)');
  }

  const preview = startPreview();
  const isReady = await preview.ready;
  if (!isReady) {
    error('Preview server failed to start');
    preview.proc.kill();
    process.exit(1);
  }

  if (opts.chromium) {
    info('Launching Chromium…');
    await launchChromium();
  }
}

ok('Done.');
