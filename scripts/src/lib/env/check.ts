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

import { existsSync, readFileSync, statSync } from 'node:fs';
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

  // Check for GOOGLE_APPLICATION_CREDENTIALS (set by secrets.ts from FIREBASE_SERVICE_ACCOUNT)
  const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credFile && existsSync(credFile)) {
    // Extract service account email from key file
    try {
      const keyContent = readFileSync(credFile, 'utf8');
      const key = JSON.parse(keyContent) as { client_email?: string; project_id?: string };
      if (key.client_email) {
        ok(`GCP service account: ${key.client_email}`);
        if (key.project_id && key.project_id !== projectId) {
          warn(
            `Service account project (${key.project_id}) differs from AIKAMI_PROJECT_ID (${projectId})`,
          );
          warn('Check MODE_PROJECT_MAP in packages/shared/constants and bootstrap.sh');
        }
        return true;
      }
    } catch {
      warn(`GOOGLE_APPLICATION_CREDENTIALS file exists but is not valid JSON: ${credFile}`);
    }
  }

  // Fallback: check gcloud user auth
  try {
    const proc = Bun.spawn({
      cmd: ['gcloud', 'auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const account = (await new Response(proc.stdout).text()).trim();
    const code = await proc.exited;

    if (code === 0 && account) {
      warn(`Using user account: ${account}`);
      warn('For service account auth, ensure FIREBASE_SERVICE_ACCOUNT is in .env.' + mode);
      warn('Run: bun run scripts/src/lib/ops/download_secrets.ts --mode=' + mode);
      return true;
    }

    warn('No GCP authentication found.');
    warn('Options:');
    warn('  1. Ensure FIREBASE_SERVICE_ACCOUNT is in apps/backend/firebase/.env.' + mode);
    warn('  2. Or run: gcloud auth application-default login');
    warn("  3. Or switch to emulator: echo 'AIKAMI_MODE=emulator' > .env.local");
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
