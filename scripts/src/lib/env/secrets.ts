#!/usr/bin/env bun
/**
 * scripts/src/lib/env/secrets.ts
 *
 * Aikami direnv secrets loader — outputs export commands for .envrc to eval.
 * In emulator mode, outputs mock values. In live modes, sources from
 * .env.{mode} files.
 *
 * Called from .envrc after bootstrap.sh sets AIKAMI_MODE:
 *   eval "$(bun run scripts/src/lib/env/secrets.ts)"
 *
 * Replaces: scripts/direnv/secrets.sh
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAikamiMode } from './mode';

// ── Configuration ────────────────────────────────────────────────────

const SECRET_KEYS = [
  'GEMINI_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT',
  'OPENROUTER_API_KEY',
  'VLM_PROVIDER',
  'VLM_MODEL',
  'VLM_TEMPERATURE',
  'VLM_NUM_PREDICT',
  'GH_TOKEN',
  'GITHUB_ACCESS_TOKEN',
] as const;

// see check.ts for cache TTL

// ── Resolve mode ──────────────────────────────────────────────────────

const mode = resolveAikamiMode();
const isEmulator = mode === 'emulator';
const root = process.env.AIKAMI_ROOT || process.cwd();

// ── Helpers ───────────────────────────────────────────────────────────

function emitExport(key: string, value: string): void {
  const escaped = value.replace(/'/g, "'\\''");
  process.stdout.write(`export ${key}='${escaped}'\n`);
}

// ── Env-file reader (shared by both modes) ────────────────────────────

function readEnvFile(modeLabel: string): Map<string, string> {
  const result = new Map<string, string>();
  const envFile = join(root, `.env.${modeLabel}`);

  if (!existsSync(envFile)) {
    return result;
  }

  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);

    // Strip matching surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if ((SECRET_KEYS as readonly string[]).includes(key)) {
      result.set(key, value);
    }
  }

  return result;
}

// ── Emulator mode ─────────────────────────────────────────────────────

function loadMocks(): void {
  process.stderr.write('  ℹ️  Secrets: using emulator mock values\n');

  // ═══ Priority: env file > process.env > mocks ═══
  // Nix devShell (use flake) strips Home Manager session vars before we
  // run, so process.env is unreliable for tokens like GH_TOKEN. The
  // .env.emulator file is the canonical source for real secrets that
  // mocks don't cover.

  const envFileValues = readEnvFile(mode);
  const mocks: Record<string, string> = {
    GEMINI_API_KEY: 'emulator-key',
  };

  for (const key of SECRET_KEYS) {
    // 1. Env file takes priority (survives Nix shell stripping)
    const fromFile = envFileValues.get(key);
    if (fromFile !== undefined) {
      emitExport(key, fromFile);
      continue;
    }

    // 2. Process env (may survive on first load before Nix stripping)
    const existing = process.env[key];
    if (existing !== undefined) {
      emitExport(key, existing);
      continue;
    }

    // 3. Fallback to mock
    const mock = mocks[key];
    if (mock !== undefined) {
      emitExport(key, mock);
    }
  }
}

// ── Live mode — load from .env.{mode} ─────────────────────────────────

const GCLOUD_DIR = join(root, '.gcloud');
const SA_KEY_FILE = join(GCLOUD_DIR, 'service-account.json');

function writeServiceAccountKey(value: string): void {
  // Validate JSON before writing
  try {
    JSON.parse(value);
  } catch {
    process.stderr.write(
      `  ⚠️  FIREBASE_SERVICE_ACCOUNT is not valid JSON — skipping gcloud auth setup\n`,
    );
    return;
  }

  mkdirSync(GCLOUD_DIR, { recursive: true });
  writeFileSync(SA_KEY_FILE, value, { mode: 0o600 });

  // Export GOOGLE_APPLICATION_CREDENTIALS so gcloud CLI and SDKs use this SA
  emitExport('GOOGLE_APPLICATION_CREDENTIALS', SA_KEY_FILE);
  process.stderr.write(`  🔑 gcloud: using service account from ${SA_KEY_FILE}\n`);
}

function loadFromEnvFile(): void {
  const envFileValues = readEnvFile(mode);

  if (envFileValues.size === 0) {
    process.stderr.write(`  ⚠️  Secrets: .env.${mode} not found or empty\n`);
    return;
  }

  let loaded = 0;
  for (const [key, value] of envFileValues) {
    emitExport(key, value);
    loaded++;

    // When FIREBASE_SERVICE_ACCOUNT is loaded, also set it up for gcloud
    if (key === 'FIREBASE_SERVICE_ACCOUNT') {
      writeServiceAccountKey(value);
    }
  }

  process.stderr.write(`  ✅ Secrets: loaded ${loaded} from .env.${mode}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────

process.stderr.write('━━━ Secret Manager ━━━\n');
process.stderr.write(`  ℹ️  Mode: ${mode}\n`);

if (isEmulator) {
  loadMocks();
} else {
  loadFromEnvFile();
}
