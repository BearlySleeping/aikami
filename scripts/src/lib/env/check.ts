#!/usr/bin/env bun
/**
 * scripts/src/lib/env/check.ts
 *
 * Aikami direnv runtime validation — checks Bun version, moon sync status,
 * Nix devShell, and GCP authentication. Outputs diagnostic info to stderr.
 *
 * Called from .envrc after bootstrap.sh:
 *   bun run scripts/src/lib/env/check.ts
 *
 * Replaces: _aikami_validate_runtime() + _aikami_gcp_check() from lib.sh
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Resolve context ────────────────────────────────────────────────────

const mode = process.env.AIKAMI_MODE || 'emulator';
const projectId = process.env.AIKAMI_PROJECT_ID || 'demo-aikami-emulator';
const isEmulator = mode === 'emulator';
const root = process.env.AIKAMI_ROOT || process.cwd();

// ── Helpers ────────────────────────────────────────────────────────────

const log = (msg: string) => process.stderr.write(`  ℹ️  ${msg}\n`);
const ok = (msg: string) => process.stderr.write(`  ✅ ${msg}\n`);
const warn = (msg: string) => process.stderr.write(`  ⚠️  ${msg}\n`);
const err = (msg: string) => process.stderr.write(`  ❌ ${msg}\n`);
const h1 = (msg: string) => process.stderr.write(`\n━━━ ${msg} ━━━\n`);

// ── GCP check ──────────────────────────────────────────────────────────

async function checkGcp(): Promise<boolean> {
  h1('Aikami Environment');
  log(`Mode: ${mode}`);
  log(`Project: ${projectId}`);

  if (isEmulator) {
    ok('Mode: emulator (local — no GCP auth needed)');
    return true;
  }

  const gcloud = Bun.which('gcloud');
  if (!gcloud) {
    warn('gcloud CLI not found — set AIKAMI_MODE=emulator in .env.local for local dev');
    return false;
  }

  try {
    const proc = Bun.spawn({
      cmd: ['gcloud', 'auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const account = (await new Response(proc.stdout).text()).trim();
    const code = await proc.exited;

    if (code === 0 && account) {
      ok(`GCP authenticated as: ${account}`);
      return true;
    }
    warn('No active gcloud auth — run: gcloud auth application-default login');
    warn("Or switch to emulator mode: echo 'AIKAMI_MODE=emulator' > .env.local");
    return false;
  } catch {
    warn('gcloud auth check failed');
    return false;
  }
}

// ── Runtime validation ─────────────────────────────────────────────────

async function validateRuntime(): Promise<void> {
  h1('Runtime Validation');

  const bun = Bun.which('bun');
  if (bun) {
    try {
      const proc = Bun.spawn({ cmd: ['bun', '--version'], stdout: 'pipe', stderr: 'pipe' });
      const ver = (await new Response(proc.stdout).text()).trim();
      ok(`Bun ${ver}`);
    } catch {
      err('Bun not found — Nix flake may not be loaded');
    }
  } else {
    err('Bun not found — Nix flake may not be loaded');
  }

  const moonYml = join(root, '.moon', 'workspace.yml');
  const cacheFile = join(root, '.moon', 'cache', 'moonlanding.txt');
  if (existsSync(moonYml)) {
    try {
      const wsStat = statSync(moonYml);
      const cacheStat = existsSync(cacheFile) ? statSync(cacheFile) : null;
      if (cacheStat && wsStat.mtimeMs > cacheStat.mtimeMs) {
        warn('moon config changed — run: bunx moon sync');
      } else {
        ok('moon projects in sync');
      }
    } catch {
      // stat failed, skip
    }
  }

  if (process.env.AIKAMI_NIX_READY || process.env.IN_NIX_SHELL) {
    ok('Nix devShell loaded');
  } else if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    ok('Nix devShell loaded (Playwright path set)');
  } else {
    warn('Nix devShell may not be loaded — some packages may be missing');
  }

  process.stderr.write('\n');
}

// ── Deps warning ───────────────────────────────────────────────────────

function checkDeps(): void {
  const lockFile = join(root, 'bun.lock');
  const installed = join(root, 'node_modules', '.installed');

  if (!existsSync(lockFile) || !existsSync(installed)) {
    return;
  }

  try {
    const lockStat = statSync(lockFile);
    const modStat = statSync(installed);
    if (lockStat.mtimeMs > modStat.mtimeMs) {
      warn('bun.lock changed since last install — run: bun install');
    }
  } catch {
    // stat failed, skip
  }
}

// ── Main ───────────────────────────────────────────────────────────────

await checkGcp();
checkDeps();
await validateRuntime();
