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
 *   - Firebase-specific keys (if applicable)
 *   - Backend / remaining keys
 *
 * Usage:
 *   bun run download-secrets --mode production
 *   bun run download-secrets --mode production client site
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

const positionalArgs = opts._;

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

/** Keys that should come from GSM (excludes PUBLIC_ for most, excludes FIREBASE_SERVICE_ACCOUNT). */
function isSecretKey(key: string): boolean {
  if (key === 'FIREBASE_SERVICE_ACCOUNT') {
    return false;
  }
  return !key.startsWith('PUBLIC_');
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
  const publicKeys = keys.filter(
    (k) => k.startsWith('PUBLIC_') && !k.startsWith('PUBLIC_FIREBASE_'),
  );
  const firebaseKeys = keys.filter(
    (k) => k.startsWith('PUBLIC_FIREBASE_') || k === 'FIREBASE_SERVICE_ACCOUNT',
  );
  const backendKeys = keys.filter(
    (k) => !k.startsWith('PUBLIC_') && k !== 'FIREBASE_SERVICE_ACCOUNT',
  );

  if (publicKeys.length > 0) {
    sections.push({ header: '------ Public ------', keys: publicKeys });
  }
  if (firebaseKeys.length > 0) {
    sections.push({ header: '---- Firebase -----', keys: firebaseKeys });
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
  existing: Record<string, string>,
  secrets: Map<string, string>,
  keyToGcm: Map<string, string>,
  defaults: Map<string, string>,
): string {
  const lines: string[] = [];
  const sections = organizeKeys(allKeys);

  for (const section of sections) {
    if (section.header) {
      lines.push(`# ${section.header}`);
    }
    for (const key of section.keys) {
      const gcmName = keyToGcm.get(key);
      if (gcmName && secrets.has(gcmName)) {
        lines.push(`${key}=${secrets.get(gcmName)}`);
      } else if (key in existing) {
        lines.push(`${key}=${existing[key]}`);
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

console.log(`\n🔐 Downloading secrets from GSM → .env.${mode} files`);
console.log(`   Project: ${GCP_PROJECT}`);
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
    if (isSecretKey(key)) {
      keyToGcm.set(key, resolveSecretName(key, config));
    }
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

// Batch-fetch all unique GSM secrets

const allGcmNames = new Set<string>();
for (const m of appMappings) {
  for (const gcmName of m.keyToGcm.values()) {
    allGcmNames.add(gcmName);
  }
}

await checkGcloudAvailable();

console.log(`   Fetching ${allGcmNames.size} unique secrets from GSM...`);
const secrets = await batchFetch(allGcmNames);

const missing = allGcmNames.size - secrets.size;
if (missing > 0) {
  const missingNames = [...allGcmNames].filter((n) => !secrets.has(n));
  console.warn(`   ⚠️  ${missing} secret(s) not found in GSM (${GCP_PROJECT}):`);
  for (const m of missingNames) {
    console.warn(`      - ${m}`);
  }

  if (opts.strict) {
    console.error(
      `\n❌ Strict mode: ${missing} secret(s) could not be fetched from GSM (${GCP_PROJECT}).`,
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
  const content = generateEnvContent(m.allKeys, existing, secrets, m.keyToGcm, m.defaults);

  await Bun.write(m.envFilePath, content);

  const secretKeysForApp = [...m.keyToGcm.keys()].length;
  const updated = [...m.keyToGcm.values()].filter((n) => secrets.has(n)).length;

  console.log(
    `  ✅ ${m.appPath}/${resolveEnvFile(mode)} — ${updated}/${secretKeysForApp} secrets from GSM`,
  );
  totalUpdated += updated;
}

console.log(`\n✅ Done — ${totalUpdated} secret(s) written across ${appMappings.length} app(s).`);
