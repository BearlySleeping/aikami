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

/** Test-only root for mode env files; keeps spawned CLI fixtures out of the checkout. */
export const SCRIPTS_ENV_ROOT_ENV = 'AIKAMI_SCRIPTS_ENV_ROOT';

/** Root containing `scripts/.env.{mode}` for this process. */
export const scriptsEnvRoot = (): string => process.env[SCRIPTS_ENV_ROOT_ENV] ?? ROOT_DIR;

let _loadedMode: string | null = null;
const _envCache = new Map<string, string>();
/**
 * Keys THIS module injected into `process.env`, with the exact value written.
 *
 * Tracked so a mode change can undo exactly its own writes. `getScriptsEnv`
 * prefers `process.env` over the cache, so an injection left behind after a
 * mode switch makes the next mode read the PREVIOUS mode's value — e.g. a
 * process that resolves `staging` and then `production` would see staging's
 * `CATALOG_BUCKET`. Values that came from direnv/CI are never in this map and
 * therefore always survive; a value someone else overwrote after our write is
 * left alone too, because it is no longer ours to undo.
 */
const _injectedValues = new Map<string, string>();

/** Undo this module's own injections, leaving direnv/CI values alone. */
const undoInjections = (): void => {
  for (const [key, value] of _injectedValues) {
    if (process.env[key] === value) {
      delete process.env[key];
    }
  }
  _injectedValues.clear();
};

/** One dotenv line as a `[key, value]` pair, or undefined for a blank/comment. */
const parseEnvLine = (line: string): [string, string] | undefined => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }
  const eq = trimmed.indexOf('=');
  if (eq === -1) {
    return undefined;
  }
  const key = trimmed.slice(0, eq).trim();
  return key ? [key, trimmed.slice(eq + 1).trim()] : undefined;
};

/**
 * Load one env file into the cache.
 *
 * `process.env` is written only for keys that are unset (direnv/CI wins), and
 * every such write is recorded so a later mode change can undo it.
 */
const loadEnvFile = (envPath: string): void => {
  if (!existsSync(envPath)) {
    return;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const pair = parseEnvLine(line);
    if (!pair) {
      continue;
    }
    const [key, value] = pair;
    _envCache.set(key, value);
    if (process.env[key] === undefined) {
      process.env[key] = value;
      _injectedValues.set(key, value);
    }
  }
};

/**
 * Load scripts/.env.{mode} into the cache (and process.env for values not
 * already set). Safe to call multiple times with the same mode — reloads if
 * mode changes.
 *
 * @param rootDir - Repo root to read `scripts/.env.{mode}` from. Defaults to
 *   this checkout; injected by tests so the mode-switch behaviour can be
 *   exercised without depending on which env files happen to be decrypted.
 */
export function initScriptsEnv(mode: string, rootDir: string = scriptsEnvRoot()): void {
  if (_loadedMode === mode) {
    return;
  }

  if (_loadedMode !== null) {
    console.warn(
      `[scripts_env] Mode change detected: ${_loadedMode} → ${mode}. Reloading env vars.`,
    );
    _envCache.clear();
    undoInjections();
  }

  loadEnvFile(join(rootDir, 'scripts', `.env.${mode}`));
  _loadedMode = mode;
}

/**
 * The mode whose env file is currently loaded, or `null` if none is.
 *
 * `initScriptsEnv` mutates process-global state, so a caller that switches modes
 * — a promotion flow, or a test — needs a way to observe and restore it. Without
 * this, a test that loads a scratch mode leaves the next one reading scratch
 * files.
 */
export const loadedScriptsEnvMode = (): string | null => _loadedMode;

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
