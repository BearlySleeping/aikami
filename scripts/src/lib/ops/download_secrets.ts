#!/usr/bin/env bun
/**
 * Download secrets from GCP Secret Manager into .env.{mode} files.
 *
 * For each app, reads .env.example to discover which keys are secrets,
 * fetches their latest values from GSM, and writes .env.{mode}.
 *
 * When no specific app is specified, collects keys from ALL apps and
 * batch-fetches all secrets in one call to minimize GSM round-trips.
 *
 * The generated .env.{mode} files are organized in sections:
 *   - PUBLIC_ keys at the top (with comment)
 *   - Backend / remaining keys
 *
 * `--mode emulator` is special-cased: `demo-aikami-emulator` isn't a real GCP
 * project, so there's nothing to fetch and no gcloud auth is required at all.
 * Required-but-blank .env.example keys get safe fake values from
 * EMULATOR_ENV_OVERRIDES instead — enough for any contributor to build/run
 * locally with zero GCP access. An existing .env.emulator's values always win
 * on re-run.
 *
 * Usage:
 *   bun run download-secrets --mode emulator            # no GCP access needed
 *   bun run download-secrets --mode production
 *   bun run download-secrets --mode production client site
 *   bun run download-secrets --mode production --keys GEMINI_API_KEY,MODE   # only those keys
 *   bun run download-secrets --mode staging --strict   # fail if any secret can't be fetched
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from '../cli_utils';
import {
  MODE_PROJECT_MAP,
  PROJECT_ENV_CONFIG,
  resolveEnvFile,
  resolveSecretName,
} from '../deploy/deployment_config';

// Resolve paths relative to the repo root
const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

const opts = parseCliArgs(Bun.argv.slice(2), {
  mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  strict: { type: 'boolean', description: 'Exit non-zero if any secret cannot be fetched' },
  keys: {
    type: 'string',
    description: 'Only process these env keys (comma-separated), e.g. --keys GEMINI_API_KEY,MODE',
  },
});
const mode = (opts.mode as string) || process.env.AIKAMI_MODE || process.env.MODE || '';
if (!mode) {
  console.error('❌ No mode specified. Use --mode=<mode> or set AIKAMI_MODE.');
  process.exit(1);
}

const GCP_PROJECT = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
if (!GCP_PROJECT) {
  console.error(`❌ Unknown mode "${mode}". Valid: ${Object.keys(MODE_PROJECT_MAP).join(', ')}`);
  process.exit(1);
}

const isEmulator = mode === 'emulator';

const positionalArgs = opts._;

/** Optional filter: only process these .env keys (empty = all). */
const keysFilter = new Set(
  (opts.keys as string | undefined)
    ?.split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0) ?? [],
);

/**
 * Fake values for keys that are required at runtime (see
 * packages/frontend/configs/src/lib/environment.ts) but must stay blank in
 * .env.example — the Firebase Auth/Firestore emulators don't validate them
 * against a real project, so any non-empty value works.
 */
const EMULATOR_ENV_OVERRIDES: Readonly<Record<string, Record<string, string>>> = {
  client: {
    PUBLIC_DISABLE_APP_CHECK: 'true',
    PUBLIC_MODE: 'emulator',
  },
  hub: {
    PUBLIC_DISABLE_APP_CHECK: '1',
    PUBLIC_MODE: 'emulator',
  },
  site: {
    PUBLIC_DISABLE_APP_CHECK: 'true',
    PUBLIC_MODE: 'emulator',
  },
};

function getTargetApps(): string[] {
  if (positionalArgs.length === 0) {
    return Object.entries(PROJECT_ENV_CONFIG)
      .filter(([, c]) => c.enabled !== false)
      .map(([name]) => name);
  }
  return positionalArgs;
}

// ── Discover secret keys from .env.example ───────────────────────────────

function readEnvKeys(appPath: string): string[] {
  const envPath = join(ROOT_DIR, appPath, '.env.example');
  if (!existsSync(envPath)) {
    return [];
  }
  const content = readFileSync(envPath, 'utf8');
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    keys.push(trimmed.slice(0, eq));
  }
  return [...new Set(keys)];
}

/** Read .env.example key → value as fallback defaults for non-secret keys. */
function readEnvDefaults(appPath: string): Map<string, string> {
  const envPath = join(ROOT_DIR, appPath, '.env.example');
  if (!existsSync(envPath)) {
    return new Map();
  }
  const content = readFileSync(envPath, 'utf8');
  const defaults = new Map<string, string>();
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
    // Only keep non-empty defaults — empty .env.example values mean "fill in yourself"
    if (value.length > 0) {
      defaults.set(key, value);
    }
  }
  return defaults;
}

/**
 * Keys that come from GSM. EVERY key is included now — including PUBLIC_ build
 * config (Firebase keys, app id, mode, site url, …): those live in GSM as
 * shared `PUBLIC_*` or prefixed `<APP>_PUBLIC_*` secrets (upload_secrets
 * pushes every non-empty env key), so download mirrors that and pulls them
 * back, stripping the prefix back to the local key name. Emulator mode never
 * fetches — it uses EMULATOR_ENV_OVERRIDES + .env.example defaults instead.
 */
function isSecretKey(_key: string): boolean {
  return true;
}

// ── GSM batch fetch ──────────────────────────────────────────────────────

/** Secrets that failed to fetch (name → first line of the error). Filled by fetchSecret. */
const fetchFailures = new Map<string, string>();

async function checkGcloudAvailable(): Promise<void> {
  try {
    const proc = Bun.spawn({
      cmd: ['gcloud', 'auth', 'print-access-token', '--quiet'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      console.error(`\n❌ gcloud is not authenticated. Run:\n   gcloud auth login --update-adc\n`);
      if (err.trim()) {
        console.error(`   ${err.trim().split('\n').join('\n   ')}`);
      }
      process.exit(1);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No such file') || msg.includes('ENOENT') || msg.includes('spawn')) {
      console.error(
        `\n❌ gcloud CLI is not installed.\n   Install: https://cloud.google.com/sdk/docs/install\n`,
      );
      process.exit(1);
    }
    throw err;
  }
}

async function fetchSecret(gcmName: string): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: [
        'gcloud',
        'secrets',
        'versions',
        'access',
        'latest',
        `--secret=${gcmName}`,
        `--project=${GCP_PROJECT}`,
        '--quiet',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const firstLine = stderr.trim().split('\n')[0] ?? 'unknown error';
      fetchFailures.set(gcmName, firstLine);
      console.warn(`   ⚠️  gcloud secret access failed for "${gcmName}": ${firstLine}`);
      return null;
    }
    return out.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fetchFailures.set(gcmName, msg);
    console.warn(`   ⚠️  Failed to fetch secret "${gcmName}": ${msg}`);
    return null;
  }
}

/** Fetch all unique GSM secret names, one gcloud call at a time. */
// Concurrent `gcloud secrets` processes collide on gcloud's own config/token
// cache files — Windows enforces strict file locks and fails with "The process
// cannot access the file because it is being used by another process". With a
// handful of secrets the sequential cost is negligible (a second or two).
async function batchFetch(gcmNames: Set<string>): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (const name of gcmNames) {
    const value = await fetchSecret(name);
    if (value !== null) {
      results.set(name, value);
    }
  }
  return results;
}

// ── .env.{mode} file generation ──────────────────────────────────────────

type Section = {
  header?: string;
  keys: string[];
};

function organizeKeys(keys: string[]): Section[] {
  const sections: Section[] = [];
  const publicKeys = keys.filter((k) => k.startsWith('PUBLIC_'));
  const backendKeys = keys.filter((k) => !k.startsWith('PUBLIC_'));

  if (publicKeys.length > 0) {
    sections.push({ header: '------ Public ------', keys: publicKeys });
  }
  if (backendKeys.length > 0) {
    sections.push({ header: '------ Backend -----', keys: backendKeys });
  }
  return sections;
}

function readExistingEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }
  const content = readFileSync(filePath, 'utf8');
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

function generateEnvContent(
  allKeys: string[],
  existingEnv: Record<string, string>,
  secretsMap: Map<string, string>,
  keyToGcm: Map<string, string>,
  defaults: Map<string, string>,
  emulatorOverrides: Record<string, string>,
): string {
  const lines: string[] = [];
  const sections = organizeKeys(allKeys);

  for (const section of sections) {
    if (section.header) {
      lines.push(`# ${section.header}`);
    }
    for (const key of section.keys) {
      const gcmName = keyToGcm.get(key);
      if (gcmName && secretsMap.has(gcmName)) {
        lines.push(`${key}=${secretsMap.get(gcmName)}`);
      } else if (key in existingEnv) {
        // Keep existing .env.emulator values — highest priority after secrets.
        lines.push(`${key}=${existingEnv[key]}`);
      } else if (key in emulatorOverrides) {
        // Emulator fakes before .env.example defaults: e.g. an intentionally
        // blank PUBLIC_FIREBASE_API_KEY default must not shadow the fake
        // emulator value, or the emulator env ends up with empty keys.
        lines.push(`${key}=${emulatorOverrides[key]}`);
      } else if (defaults.has(key)) {
        lines.push(`${key}=${defaults.get(key)}`);
      } else {
        lines.push(`${key}=`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────

const appNames = getTargetApps();

if (isEmulator) {
  console.log(`\n🧪 Generating local emulator env → .env.${mode} files (no GCP access needed)`);
} else {
  console.log(`\n🔐 Downloading secrets from GSM → .env.${mode} files`);
  console.log(`   Project: ${GCP_PROJECT}`);
}
if (keysFilter.size > 0) {
  console.log(`   Keys:    ${[...keysFilter].join(', ')} (filtered)`);
}
console.log(`   Apps:    ${appNames.join(', ')}\n`);

// Collect all key → gcmName mappings across all target apps

type AppMapping = {
  appName: string;
  appPath: string;
  envFilePath: string;
  allKeys: string[];
  keyToGcm: Map<string, string>;
  defaults: Map<string, string>;
};

const appMappings: AppMapping[] = [];

for (const appName of appNames) {
  const config = PROJECT_ENV_CONFIG[appName];
  if (!config) {
    console.error(`❌ Config not found for "${appName}"`);
    continue;
  }

  const appPath = config.path;
  if (!existsSync(join(ROOT_DIR, appPath, '.env.example'))) {
    console.log(`  ⚠️  No .env.example in ${appPath} — skipping`);
    continue;
  }

  const allKeys = readEnvKeys(appPath);
  if (allKeys.length === 0) {
    console.log(`  ℹ️  No keys in ${appPath}/.env.example — skipping`);
    continue;
  }

  const keyToGcm = new Map<string, string>();
  for (const key of allKeys) {
    if (!isSecretKey(key)) {
      continue;
    }
    if (keysFilter.size > 0 && !keysFilter.has(key)) {
      continue;
    }
    keyToGcm.set(key, resolveSecretName(key, config));
  }

  appMappings.push({
    appName,
    appPath,
    envFilePath: join(ROOT_DIR, appPath, resolveEnvFile(mode)),
    allKeys,
    keyToGcm,
    defaults: readEnvDefaults(appPath),
  });
}

// Warn about requested keys that no target app exposes as a fetchable secret
if (keysFilter.size > 0) {
  const foundKeys = new Set<string>();
  for (const m of appMappings) {
    for (const key of m.keyToGcm.keys()) {
      foundKeys.add(key);
    }
  }
  const unmatched = [...keysFilter].filter((k) => !foundKeys.has(k));
  if (unmatched.length > 0) {
    console.warn(
      `   ⚠️  Key(s) not fetchable from GSM (not a secret key in any target app's .env.example): ${unmatched.join(', ')}`,
    );
  }
}

// Batch-fetch all unique GSM secrets (skipped entirely in emulator mode —
// demo-aikami-emulator isn't a real GCP project, so there's nothing to fetch
// and no gcloud auth is required).

const allGcmNames = new Set<string>();
for (const m of appMappings) {
  for (const gcmName of m.keyToGcm.values()) {
    allGcmNames.add(gcmName);
  }
}

let secrets = new Map<string, string>();

if (isEmulator) {
  console.log(`   Skipping GSM (emulator mode) — using .env.example + fake local defaults\n`);
} else {
  await checkGcloudAvailable();

  console.log(`   Fetching ${allGcmNames.size} unique secrets from GSM...`);
  secrets = await batchFetch(allGcmNames);
}

const missing = isEmulator ? 0 : allGcmNames.size - secrets.size;
if (missing > 0) {
  const missingNames = [...allGcmNames].filter((n) => !secrets.has(n));
  // PUBLIC_ build-config keys are optional — blank is a valid value (log
  // levels, recaptcha key, analytics ids). Never fatal, even with --strict,
  // so CI (release.yml runs --strict) isn't blocked by an unset optional.
  // Classify by the ORIGINAL local env key (GSM names may not carry the
  // PUBLIC_ prefix), so only local keys starting with PUBLIC_ are treated
  // as public; everything else is a secret.
  const gcmToKey = new Map<string, string>();
  for (const m of appMappings) {
    for (const [localKey, gcmName] of m.keyToGcm) {
      gcmToKey.set(gcmName, localKey);
    }
  }
  const missingPublic = missingNames.filter((n) => gcmToKey.get(n)?.startsWith('PUBLIC_'));
  const missingSecret = missingNames.filter((n) => !gcmToKey.get(n)?.startsWith('PUBLIC_'));
  if (missingPublic.length > 0) {
    console.warn(
      `   ⚠️  ${missingPublic.length} public build-config key(s) not in GSM (stays blank/default):`,
    );
    for (const m of missingPublic) {
      console.warn(`      - ${m}`);
    }
  }
  if (missingSecret.length > 0) {
    console.warn(`   ⚠️  ${missingSecret.length} secret(s) not found in GSM (${GCP_PROJECT}):`);
    for (const m of missingSecret) {
      console.warn(`      - ${m}`);
    }
  }

  if (opts.strict && missingSecret.length > 0) {
    console.error(
      `\n❌ Strict mode: ${missingSecret.length} secret(s) could not be fetched from GSM (${GCP_PROJECT}).`,
    );
    console.error('   Failing early — the generated .env files would be incomplete.');
    for (const [name, reason] of fetchFailures) {
      console.error(`      - ${name}: ${reason}`);
    }
    console.error('   Fix: grant the deploy SA secretmanager.secretAccessor, create the missing');
    console.error('   secrets, or re-run without --strict to proceed with warnings.');
    process.exit(1);
  }
}
console.log('');

// Generate .env.{mode} for each app

let totalUpdated = 0;

for (const m of appMappings) {
  const existing = readExistingEnv(m.envFilePath);
  const emulatorOverrides = isEmulator ? (EMULATOR_ENV_OVERRIDES[m.appName] ?? {}) : {};
  const content = generateEnvContent(
    m.allKeys,
    existing,
    secrets,
    m.keyToGcm,
    m.defaults,
    emulatorOverrides,
  );

  await Bun.write(m.envFilePath, content);

  if (isEmulator) {
    console.log(`  ✅ ${m.appPath}/${resolveEnvFile(mode)}`);
  } else {
    const secretKeysForApp = [...m.keyToGcm.keys()].length;
    const updated = [...m.keyToGcm.values()].filter((n) => secrets.has(n)).length;
    console.log(
      `  ✅ ${m.appPath}/${resolveEnvFile(mode)} — ${updated}/${secretKeysForApp} secrets from GSM`,
    );
    totalUpdated += updated;
  }
}

if (isEmulator) {
  console.log(`\n✅ Done — generated .env.emulator for ${appMappings.length} app(s).`);
} else {
  console.log(`\n✅ Done — ${totalUpdated} secret(s) written across ${appMappings.length} app(s).`);
}
