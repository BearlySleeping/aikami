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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Configuration ────────────────────────────────────────────────────

const SECRET_KEYS = [
  'GEMINI_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT',
  'OPENROUTER_API_KEY',
  'VLM_PROVIDER',
  'VLM_MODEL',
  'VLM_TEMPERATURE',
  'VLM_NUM_PREDICT',
] as const;

// see check.ts for cache TTL

// ── Resolve mode ──────────────────────────────────────────────────────

const mode = process.env.AIKAMI_MODE || 'emulator';
const isEmulator = mode === 'emulator';
const root = process.env.AIKAMI_ROOT || process.cwd();

// ── Helpers ───────────────────────────────────────────────────────────

function emitExport(key: string, value: string): void {
  const escaped = value.replace(/'/g, "'\\''");
  process.stdout.write(`export ${key}='${escaped}'\n`);
}

// ── Emulator mode ─────────────────────────────────────────────────────

function loadMocks(): void {
  process.stderr.write('  ℹ️  Secrets: using emulator mock values\n');
  const mocks: Record<string, string> = {
    // biome-ignore lint/style/useNamingConvention: env var name
    GEMINI_API_KEY: 'emulator-key',
  };
  for (const key of SECRET_KEYS) {
    if (process.env[key]) {
      continue;
    }
    const mock = mocks[key];
    if (mock !== undefined) {
      emitExport(key, mock);
    }
  }
}

// ── Live mode — load from .env.{mode} ─────────────────────────────────

function loadFromEnvFile(): void {
  const envFile = join(root, `.env.${mode}`);

  if (!existsSync(envFile)) {
    process.stderr.write(`  ⚠️  Secrets: .env.${mode} not found\n`);
    return;
  }

  const content = readFileSync(envFile, 'utf8');
  let loaded = 0;

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
    const value = trimmed.slice(eq + 1);

    if ((SECRET_KEYS as readonly string[]).includes(key) && !process.env[key]) {
      emitExport(key, value);
      loaded++;
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
