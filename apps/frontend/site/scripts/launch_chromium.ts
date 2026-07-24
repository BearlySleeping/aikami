// apps/frontend/site/scripts/launch_chromium.ts
//
// Site Preview Launcher — starts the Astro dev server (if not running)
// and opens Chromium for visual testing with a clean temp profile.
//
// Usage:
//   bun run scripts/launch_chromium.ts                        # emulator mode (port 5280)
//   bun run scripts/launch_chromium.ts -- --port 5280         # explicit port
//   bun run scripts/launch_chromium.ts -- --mode production   # production mode
//   bun run scripts/launch_chromium.ts -- --path /faq         # open specific page
//
// CLI flags:
//   --port  <number>        [default: 5280 (emulator site port)]
//   --mode  <emulator|staging|production>  [default: emulator]
//   --path  <string>        URL path to open [default: /]

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'bun';

// ── Arg parsing ────────────────────────────────────────────────────
const parseArg = (args: string[], flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
};

const cliArgs = argv.slice(2);
const PORT = Number(parseArg(cliArgs, '--port') ?? '5280');
const _MODE = parseArg(cliArgs, '--mode') ?? 'emulator';
const URL_PATH = parseArg(cliArgs, '--path') ?? '/';
const ROOT = resolve(import.meta.dir, '..');

const BASE_URL = `http://localhost:${PORT}`;
const TARGET_URL = `${BASE_URL}${URL_PATH}`;

// ── Temp profile ───────────────────────────────────────────────────
const profileDir = resolve(ROOT, '.tmp', 'chromium-profile');
mkdirSync(profileDir, { recursive: true });

// ── Ensure dev server is running ───────────────────────────────────
const checkServer = async (): Promise<boolean> => {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

const isRunning = await checkServer();
if (!isRunning) {
  const server = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait until server responds
  for (let i = 0; i < 60; i++) {
    if (await checkServer()) {
      break;
    }
    await Bun.sleep(500);
  }

  if (!(await checkServer())) {
    server.kill();
    process.exit(1);
  }

  // Detach — let the server keep running after this script exits
  server.unref();
}

// ── Launch Chromium ────────────────────────────────────────────────
const proc = Bun.spawn(
  [
    'chromium',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--no-pings',
    '--window-size=1440,900',
    `--app=${TARGET_URL}`,
  ],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);

await proc.exited;
