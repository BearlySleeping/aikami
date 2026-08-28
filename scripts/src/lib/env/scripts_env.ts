// scripts/src/lib/env/scripts_env.ts
/**
 * Scripts env loader — resolves variables from scripts/.env.{mode} as a
 * fallback when process.env doesn't have them.
 *
 * Priority:
 *   1. process.env.X (already set by direnv, CI, or explicit export)
 *   2. scripts/.env.{mode} (populated by decrypt_secrets.ts)
 *
 * The file is read once and cached — subsequent calls hit the cache.
 *
 * Usage:
 *   import { initScriptsEnv, getScriptsEnv } from '../env/scripts_env';
 *
 *   const mode = resolveMode();
 *   initScriptsEnv(mode);
 *   const redisUrl = getScriptsEnv('REDIS_URL', mode);
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAikamiMode } from './mode';

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
// scripts/src/lib/env/scripts_env.ts → go up 4 levels to repo root
const ROOT_DIR = resolve(_scriptDir, '../../../..');

let _loadedMode: string | null = null;
const _envCache = new Map<string, string>();

/**
 * Load scripts/.env.{mode} into the cache (and process.env for values not
 * already set). Safe to call multiple times with the same mode — reloads if
 * mode changes.
 */
export function initScriptsEnv(mode: string): void {
  if (_loadedMode === mode) {
    return;
  }

  if (_loadedMode !== null && _loadedMode !== mode) {
    console.warn(
      `[scripts_env] Mode change detected: ${_loadedMode} → ${mode}. Reloading env vars.`,
    );
    _envCache.clear();
  }

  const envPath = join(ROOT_DIR, 'scripts', `.env.${mode}`);

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!key) {
        continue;
      }

      _envCache.set(key, value);

      // Only inject into process.env if not already set (don't override direnv/CI)
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  _loadedMode = mode;
}

/**
 * Resolve an environment variable.
 *
 * Priority:
 *   1. process.env[key] (already set — direnv, CI, or explicit)
 *   2. scripts/.env.{mode} cache (loaded by initScriptsEnv or auto-init)
 *   3. undefined
 *
 * If initScriptsEnv hasn't been called yet, auto-initializes from
 * process.env.AIKAMI_MODE so standalone scripts don't need explicit setup.
 */
export function getScriptsEnv(key: string): string | undefined {
  if (_loadedMode === null) {
    initScriptsEnv(resolveAikamiMode());
  }
  return process.env[key] ?? _envCache.get(key);
}
