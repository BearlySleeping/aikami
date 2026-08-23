#!/usr/bin/env bun
// scripts/src/lib/ops/tauri_appimage.ts
//
// Builds the Aikami AppImage inside an Ubuntu 22.04 container.
//
// Why a container — Tauri's AppImage bundler reads `/usr/bin/xdg-mime` and
// `/usr/bin/xdg-open` from hard-coded absolute paths (we ship
// tauri-plugin-deep-link, which makes them mandatory) and harvests webkit/gtk/
// gstreamer libraries out of `/usr/lib/x86_64-linux-gnu`. It also shells out to
// linuxdeploy's Debian-shaped gtk/gstreamer plugin scripts. None of those paths
// exist on NixOS, and no flag redirects them, so `tauri build` fails there with
// "xdg-mime binary not found /usr/bin/xdg-mime" no matter what's on PATH.
//
// 22.04 is not arbitrary: it matches PLATFORM_DEFAULTS in deploy/ci_planning.ts,
// so the AppImage you test locally has the same glibc floor as the released one.
//
// For day-to-day debugging you do NOT need this — `bun run scripts -- preview
// --tauri` gives you the real desktop app (deep links included) with no
// container involved. Use this when you specifically need to verify the
// *bundle*.
//
// Usage:
//   bun run scripts -- tauri_appimage                    # emulator build
//   bun run scripts -- tauri_appimage --mode staging
//   bun run scripts -- tauri_appimage --rebuild-image    # refresh the builder image
//   bun run scripts -- tauri_appimage --runtime podman

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { c, error, info, ok, parseArg, step, warn } from '../cli_utils.ts';

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, '../../../..');
const DOCKERFILE = resolve(ROOT, 'apps/frontend/client/src-tauri/appimage.Dockerfile');
const DOCKER_CONTEXT = resolve(ROOT, 'apps/frontend/client/src-tauri');
const OUT_DIR = resolve(ROOT, 'dist/appimage');

const IMAGE_TAG = 'aikami-appimage-builder:ubuntu-22.04';
/** Named volumes so the ~15-25 min cargo compile is paid once, not per run. */
const CARGO_VOLUME = 'aikami-appimage-cargo';
const TARGET_VOLUME = 'aikami-appimage-target';

const VALID_MODES = ['emulator', 'staging', 'production'] as const;
type AikamiMode = (typeof VALID_MODES)[number];

// ── Helpers ────────────────────────────────────────────────────────────────

const spawnInherit = async (cmd: string[]): Promise<number> => {
  info(`${c.dim}$ ${cmd.join(' ')}${c.reset}`);
  const proc = Bun.spawn(cmd, { stdio: ['inherit', 'inherit', 'inherit'], cwd: ROOT });
  return await proc.exited;
};

const binaryExists = async (name: string): Promise<boolean> => {
  const proc = Bun.spawn(['sh', '-c', `command -v ${name}`], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return (await proc.exited) === 0;
};

/**
 * NixOS (and Fedora, and anyone with podman-docker installed) ships a `docker`
 * that is really podman, and the two need *opposite* user-mapping flags —
 * guessing from the command name silently produces an unwritable mount.
 *
 * Asking the binary doesn't help: the compatibility shim answers `--version`
 * with "docker version 5.8.4" and `info` with runc, precisely so tools can't
 * tell. Resolving the symlink chain does, since the shim is podman itself.
 */
const isPodman = async (containerRuntime: string): Promise<boolean> => {
  if (containerRuntime.includes('podman')) {
    return true;
  }
  const proc = Bun.spawn(['sh', '-c', `realpath "$(command -v ${containerRuntime})"`], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const realPath = await new Response(proc.stdout).text();
  await proc.exited;
  return realPath.includes('podman');
};

const resolveRuntime = async (explicit: string | undefined): Promise<string> => {
  if (explicit) {
    if (!(await binaryExists(explicit))) {
      error(`Container runtime "${explicit}" not found on PATH.`);
      process.exit(1);
    }
    return explicit;
  }
  for (const candidate of ['docker', 'podman']) {
    if (await binaryExists(candidate)) {
      return candidate;
    }
  }
  error('Neither docker nor podman found on PATH.');
  info('Add one to your system config, or build the AppImage in CI instead:');
  info(`  ${c.cyan}gh workflow run release.yml -f platforms=linux -f bundles=appimage${c.reset}`);
  process.exit(1);
};

const parseMode = (raw: string | undefined): AikamiMode => {
  if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
    return raw as AikamiMode;
  }
  if (raw) {
    warn(`Unknown mode "${raw}" — falling back to emulator`);
  }
  return 'emulator';
};

/**
 * Rootless podman maps the caller onto the container user with --userns=keep-id;
 * passing it a plain --user instead resolves the uid inside the *sub*uid range
 * and every write to the mounted worktree fails with EACCES. Real docker has no
 * such mapping, so it needs the explicit --user or it writes root-owned build
 * output into the worktree.
 */
const ownershipArgs = (rootlessPodman: boolean): string[] =>
  rootlessPodman
    ? ['--userns=keep-id']
    : ['--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`];

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = parseMode(parseArg(args, '--mode'));
const rebuildImage = args.includes('--rebuild-image');
const runtime = await resolveRuntime(parseArg(args, '--runtime'));
const podman = await isPodman(runtime);

console.log(`\n${c.bold}Aikami AppImage (containerised)${c.reset}\n`);
info(`Runtime: ${runtime}${podman ? ' (podman)' : ''}`);
info(`Mode:    ${mode}`);
info(`Output:  ${OUT_DIR}`);

// 1. Builder image — cached after the first run unless --rebuild-image.
step('Building the Ubuntu 22.04 builder image');
const buildImageCmd = [
  runtime,
  'build',
  '-f',
  DOCKERFILE,
  '-t',
  IMAGE_TAG,
  ...(rebuildImage ? ['--no-cache'] : []),
  DOCKER_CONTEXT,
];
if ((await spawnInherit(buildImageCmd)) !== 0) {
  error('Builder image build failed.');
  process.exit(1);
}

// 2. The build itself.
//
// CARGO_TARGET_DIR points at a volume rather than the worktree's
// src-tauri/target on purpose: the host's artifacts are linked against Nix's
// glibc and the container's against 22.04's, and sharing one directory makes
// cargo rebuild everything on every switch (and can produce an AppImage that
// silently bundles host libraries).
mkdirSync(OUT_DIR, { recursive: true });

const containerScript = [
  'set -eu',
  'cd /workspace/apps/frontend/client',
  // node_modules comes from the mounted worktree — same linux-x64-gnu packages
  // bun installed on the host, so there is nothing to re-install here.
  'bunx tauri build --bundles appimage',
  'cp -v "$CARGO_TARGET_DIR"/release/bundle/appimage/*.AppImage /out/',
].join('\n');

step('Running tauri build --bundles appimage');
const runCmd = [
  runtime,
  'run',
  '--rm',
  '-i',
  ...ownershipArgs(podman),
  '-v',
  `${ROOT}:/workspace`,
  '-v',
  `${OUT_DIR}:/out`,
  '-v',
  `${CARGO_VOLUME}:/opt/cargo/registry`,
  '-v',
  `${TARGET_VOLUME}:/target-cache`,
  '-e',
  'HOME=/tmp',
  '-e',
  'CARGO_TARGET_DIR=/target-cache',
  '-e',
  `TAURI_BUILD_MODE=${mode}`,
  '-w',
  '/workspace',
  IMAGE_TAG,
  'bash',
  '-c',
  containerScript,
];

if ((await spawnInherit(runCmd)) !== 0) {
  error('AppImage build failed.');
  info('If it failed on missing env vars, generate them first:');
  info(`  ${c.cyan}bun run scripts/src/lib/ops/download_secrets.ts --mode ${mode}${c.reset}`);
  process.exit(1);
}

ok(`AppImage written to ${OUT_DIR}`);
info('Run it with:');
info(`  ${c.cyan}chmod +x ${OUT_DIR}/*.AppImage && ${OUT_DIR}/*.AppImage${c.reset}`);
warn('NixOS needs appimage-run (or an FHS wrapper) to execute an AppImage:');
info(`  ${c.cyan}nix run nixpkgs#appimage-run -- ${OUT_DIR}/Aikami_*.AppImage${c.reset}`);
