#!/usr/bin/env bun
// scripts/src/lib/ops/run_tauri.ts
//
// Launches the already-built Tauri desktop binary for the current OS.
// Does NOT build — this just finds and runs what's already on disk.
//
// Usage:
//   bun run scripts/src/lib/ops/run_tauri.ts
//   bun moon run client:tauri-run
//   bun moon run client:tauri-run -- --route /dev/tauri-test
//   bun run scripts/src/lib/ops/run_tauri.ts --software-gl
//   bun run scripts/src/lib/ops/run_tauri.ts --gdk-scale 1

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { c, error, info, ok, warn } from '../cli_utils.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const TARGET_DIR = resolve(ROOT, 'apps/frontend/client/src-tauri/target');
const BIN_NAME = process.platform === 'win32' ? 'aikami.exe' : 'aikami';

const argv = process.argv.slice(2);

/**
 * Reads a `--flag value` pair from argv.
 *
 * @param names - Accepted spellings of the flag, e.g. `['--route']`.
 * @returns The value, or `undefined` when the flag is absent.
 */
const readFlagValue = (names: string[]): string | undefined => {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index !== -1) {
      return argv[index + 1];
    }
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    if (inline) {
      return inline.slice(name.length + 1);
    }
  }
  return undefined;
};

// The Rust side (src-tauri/src/lib.rs, parse_startup_route) reads `--route
// <path>` and bakes it into the initial WebviewUrl, so the window opens
// straight on that route instead of booting '/' and navigating. `--init-route`
// is accepted as an alias because that is what the task is usually called.
const routeArg = readFlagValue(['--route', '--init-route', '--path']);
const gdkScaleRaw = readFlagValue(['--gdk-scale']);
if (routeArg !== undefined && (routeArg === '' || routeArg.startsWith('--'))) {
  error('--route requires a path, e.g. --route /dev/tauri-test');
  process.exit(1);
}
// The Rust parser matches on the exact arg pair, so normalize `--init-route`
// and any `--route=/x` spelling down to the `--route /x` form it expects.
const normalizeRoute = (route: string): string => (route.startsWith('/') ? route : `/${route}`);
const startupRoute = routeArg === undefined ? undefined : normalizeRoute(routeArg);

// An unrecognized flag used to be dropped in silence — the app just booted on
// '/' and the mistake looked like the route feature being broken. Name it.
const KNOWN_FLAGS = new Set([
  '--route',
  '--init-route',
  '--path',
  '--software-gl',
  '--sw-gl',
  '--gdk-scale',
  '--dry-run',
  '--',
]);
const flagName = (arg: string): string => arg.split('=')[0] ?? arg;
const consumedValues = new Set(
  [routeArg, gdkScaleRaw].filter((value): value is string => value !== undefined),
);
for (const arg of argv) {
  if (!arg.startsWith('-') || KNOWN_FLAGS.has(flagName(arg)) || consumedValues.has(arg)) {
    continue;
  }
  warn(`Ignoring unknown flag "${arg}" — did you mean --route?`);
}

/**
 * WebKitGTK environment overrides that avoid wedging the Intel i915 GPU on
 * hybrid-graphics laptops (screen freeze + audio-alive hang) and the silent
 * WebGL init stalls that leave the map/sprite canvas blank while the DOM
 * (HUD, pause, inventory) still renders fine. Mirrors preview_client.ts's
 * getWebkitGtkSafeEnv — this launcher runs the packaged binary directly, so
 * it needs the same mitigations preview_client.ts bakes into its own spawn.
 *
 * `WEBKIT_DISABLE_DMABUF_RENDERER` is a dead end on WebKitGTK >= 2.44 (X11/WPE
 * renderers were removed); `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` is the
 * supported workaround that keeps compositing while avoiding the DMA-BUF
 * import path. `--software-gl` forces the whole webview onto llvmpipe.
 */
const softwareGl = argv.includes('--software-gl') || argv.includes('--sw-gl');

/**
 * `--gdk-scale <n>` pins GDK's window scale factor.
 *
 * On this NixOS/webkitgtk host every DOM viewport metric is derived from a
 * *negative* device scale factor — devicePixelRatio reports exactly -1/96
 * and innerWidth reports -(cssWidth * 96), so Pixi computes a canvas backing
 * store WebKit refuses to allocate. Forcing an integer GDK scale is the
 * cheapest way to test whether the bad value originates in GDK rather than
 * in wry. Off by default: pinning it to 1 on a genuine HiDPI display renders
 * the app at half size. Use /dev/tauri-test to compare before and after.
 */
const gdkScale = gdkScaleRaw;
if (gdkScale !== undefined && !/^\d+$/.test(gdkScale)) {
  error(`--gdk-scale must be a positive integer (got "${gdkScale}")`);
  process.exit(1);
}

const webkitGtkSafeEnv: Record<string, string> = {
  WEBKIT_DMABUF_RENDERER_FORCE_SHM: '1',
  ...(softwareGl ? { LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' } : {}),
  ...(gdkScale ? { GDK_SCALE: gdkScale, GDK_DPI_SCALE: '1' } : {}),
};

// release (`bun moon run client:tauri-build`) wins over debug
// (`bun run preview --tauri` / `--tauri-dev`) when both exist.
const candidates = [
  { profile: 'release', path: resolve(TARGET_DIR, 'release', BIN_NAME) },
  { profile: 'debug', path: resolve(TARGET_DIR, 'debug', BIN_NAME) },
];

const found = candidates.find((candidate) => existsSync(candidate.path));

if (!found) {
  error('No built Tauri binary found.');
  info('Build one first:');
  info(
    `  ${c.cyan}bun moon run client:tauri-build${c.reset}   # release bundle (installers + binary)`,
  );
  info(`  ${c.cyan}bun run preview --tauri${c.reset}            # debug build, faster iterate`);
  process.exit(1);
}

ok(`Launching ${found.profile} build -> ${found.path}`);
if (startupRoute) {
  info(`  route: ${c.cyan}${startupRoute}${c.reset}`);
}
if (gdkScale) {
  warn(`  GDK_SCALE=${gdkScale} GDK_DPI_SCALE=1 (viewport-metrics experiment)`);
}
if (softwareGl) {
  info('  software GL (llvmpipe)');
}

const binArgs = startupRoute ? ['--route', startupRoute] : [];

// `--dry-run` resolves everything and prints the command without opening a
// window — used to verify flag plumbing through `moon run ... -- --route x`.
if (argv.includes('--dry-run')) {
  info(`  would exec: ${[found.path, ...binArgs].join(' ')}`);
  info(`  env overrides: ${JSON.stringify(webkitGtkSafeEnv)}`);
  process.exit(0);
}

const proc = Bun.spawn([found.path, ...binArgs], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, ...webkitGtkSafeEnv },
});

const code = await proc.exited;
process.exit(code);
