#!/usr/bin/env bun

/**
 * Regenerates the Tauri CSP `connect-src` allowlist in
 * apps/frontend/client/src-tauri/tauri.conf.json from the provider registry
 * in @aikami/constants (packages/shared/constants/src/lib/providers.ts).
 *
 * Every TEXT_PROVIDERS / VOICE_PROVIDERS / IMAGE_PROVIDERS entry with a
 * fixed `apiBaseUrl` (openrouter.ai, api.openai.com, ...) is added as its
 * own origin, so adding a new cloud provider to the constants file is
 * enough — no manual tauri.conf.json edit needed.
 *
 * Providers without a fixed `apiBaseUrl` (ollama, llamacpp, custom, local
 * TTS/image servers, the "Custom API" / "OpenAI Compatible" entries, ...)
 * take a user-typed URL at runtime, so no static host can be allowlisted
 * for them. Rather than silently leaving those broken, this script adds a
 * blanket `https://*` / `http://*` to connect-src — the desktop app is a
 * BYOK client the user points at servers of their own choosing, so this
 * directive isn't meaningfully protective for that traffic anyway. Other
 * CSP directives (script-src, style-src, img-src) are untouched and keep
 * doing the real work of blocking injected script execution.
 *
 * Run directly: `bun scripts/update_cors.ts`
 * Wired into `beforeDevCommand` / `beforeBuildCommand` in tauri.conf.json
 * so it re-runs before every `tauri dev` / `tauri build`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_PROVIDERS, TEXT_PROVIDERS, VOICE_PROVIDERS } from '@aikami/constants';
import { logger } from '@aikami/logger';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_CONF_PATH = join(CLIENT_DIR, 'src-tauri', 'tauri.conf.json');

// Entries with no fixed provider origin behind them — Aikami's own hub
// deployments, the CDN, the IPC scheme, and locally-run backend engines
// (ports from packages/shared/constants/src/lib/development_ports.ts).
const BASE_CONNECT_SRC = [
  "'self'",
  'tauri:',
  'asset:',
  'blob:',
  'data:',
  'ipc:',
  'http://ipc.localhost',
  'https://hub.bearlysleeping.com',
  'https://hub.stg.bearlysleeping.com',
  'https://assets.bearlysleeping.com',
  'http://localhost:11434', // FIXED_PORTS.text (Ollama / llama.cpp default)
  'http://localhost:8188', // FIXED_PORTS.image (ComfyUI default)
  'http://localhost:8089', // FIXED_PORTS.voice (Kokoro default)
  'http://localhost:6006',
  'http://localhost:5276', // OFFSETTABLE_PORTS.hub (local hub dev server)
];

// Local/custom-URL providers take an arbitrary user-supplied endpoint at
// runtime — no fixed host can be allowlisted, so connect-src is opened for
// any origin instead of silently failing for whatever the user configures.
const WILDCARD_CONNECT_SRC = ['https://*', 'http://*'];

const collectProviderOrigins = (): string[] => {
  const origins = new Set<string>();
  for (const provider of [...TEXT_PROVIDERS, ...VOICE_PROVIDERS, ...IMAGE_PROVIDERS]) {
    const apiBaseUrl = (provider as { apiBaseUrl?: string }).apiBaseUrl;
    if (!apiBaseUrl) {
      continue;
    }
    origins.add(new URL(apiBaseUrl).origin);
  }
  return [...origins].sort();
};

const buildConnectSrc = (): string => {
  const entries = [...BASE_CONNECT_SRC, ...collectProviderOrigins(), ...WILDCARD_CONNECT_SRC];
  return entries.join(' ');
};

type TauriConfig = {
  app: {
    security: {
      csp: string;
    };
  };
};

const raw = readFileSync(TAURI_CONF_PATH, 'utf-8');
const config = JSON.parse(raw) as TauriConfig;

const csp = config.app.security.csp;
const connectSrcMatch = csp.match(/connect-src [^;]+/);
if (!connectSrcMatch) {
  logger.error(`❌ No connect-src directive found in ${TAURI_CONF_PATH}`);
  process.exit(1);
}

const newConnectSrc = `connect-src ${buildConnectSrc()}`;
const newCsp = csp.replace(connectSrcMatch[0], newConnectSrc);

if (newCsp === csp) {
  logger.info('✅ tauri.conf.json connect-src already up to date.');
  process.exit(0);
}

config.app.security.csp = newCsp;
writeFileSync(TAURI_CONF_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
logger.info(`✅ Updated connect-src in ${TAURI_CONF_PATH}`);
