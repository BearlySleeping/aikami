#!/usr/bin/env bun
/**
 * Decrypt secrets from secrets/{mode}.enc.env into each app's .env.{mode}.
 *
 * For each app, reads .env.example to discover which keys it needs, decrypts
 * secrets/{mode}.enc.env once, and writes .env.{mode}.
 *
 * The generated .env.{mode} files are organized in sections:
 *   - PUBLIC_ keys at the top (with comment)
 *   - Backend / remaining keys
 *
 * `--mode emulator` is special-cased: there's no encrypted bundle for it, so
 * nothing is decrypted and no age key is required at all. Required-but-blank
 * .env.example keys get safe fake values from EMULATOR_ENV_OVERRIDES instead
 * — enough for any contributor to build/run locally with zero setup. An
 * existing .env.emulator's values always win on re-run.
 *
 * Usage:
 *   bun run decrypt-secrets --mode emulator            # no age key needed
 *   bun run decrypt-secrets --mode production
 *   bun run decrypt-secrets --mode production client site
 *   bun run decrypt-secrets --mode production --keys GEMINI_API_KEY,MODE   # only those keys
 *   bun run decrypt-secrets --mode staging --strict   # fail if any key is missing from the bundle
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modes } from '@aikami/constants';
import { parseCliArgs } from '../cli_utils';
import { PROJECT_ENV_CONFIG, resolveEnvFile, resolveSecretName } from '../deploy/deployment_config';
import { NEVER_ENCRYPT_KEYS, sopsDecrypt } from './secrets_backend';

// Resolve paths relative to the repo root
const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

const opts = parseCliArgs(Bun.argv.slice(2), {
  mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  strict: { type: 'boolean', description: 'Exit non-zero if any key is missing from the bundle' },
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
if (!(modes as readonly string[]).includes(mode)) {
  console.error(`❌ Unknown mode "${mode}". Valid: ${modes.join(', ')}`);
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
 * .env.example — the emulator doesn't validate them against a real project,
 * so any non-empty value works.
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

/**
 * Non-secret, per-developer tuning keys. A value a developer has already set
 * locally in .env.{mode} wins over the decrypted value on every re-run, so
 * `bun run decrypt-secrets` doesn't clobber a deliberate local override (e.g.
 * flipping on debug logging against a production build). Deliberately a
 * narrow allowlist, not "local always wins" — that would silently mask a
 * rotated real secret behind a stale local copy.
 */
const LOCAL_OVERRIDABLE_KEYS = new Set([
  'LOG_LEVEL',
  'PUBLIC_LOG_LEVEL',
  'PUBLIC_LOG_PERSIST_LEVEL',
  'PUBLIC_ERUDA_ENABLED',
  'PUBLIC_PARSE_LEVEL',
]);

function getTargetApps(): string[] {
  if (positionalArgs.length === 0) {
    return Object.entries(PROJECT_ENV_CONFIG)
      .filter(([, c]) => c.enabled !== false)
      .map(([name]) => name);
  }
  return positionalArgs;
}

// ── Discover keys from .env.example ───────────────────────────────────────

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
  keyToSecretName: Map<string, string>,
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
      const secretName = keyToSecretName.get(key);
      if (LOCAL_OVERRIDABLE_KEYS.has(key) && key in existingEnv) {
        // A developer's local tuning value wins over the decrypted value —
        // see LOCAL_OVERRIDABLE_KEYS.
        lines.push(`${key}=${existingEnv[key]}`);
      } else if (secretName && secretsMap.has(secretName)) {
        lines.push(`${key}=${secretsMap.get(secretName)}`);
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
  console.log(`\n🧪 Generating local emulator env → .env.${mode} files (no setup needed)`);
} else {
  console.log(`\n🔓 Decrypting secrets/${mode}.enc.env → .env.${mode} files`);
}
if (keysFilter.size > 0) {
  console.log(`   Keys:    ${[...keysFilter].join(', ')} (filtered)`);
}
console.log(`   Apps:    ${appNames.join(', ')}\n`);

// Collect all key → secretName mappings across all target apps

type AppMapping = {
  appName: string;
  appPath: string;
  envFilePath: string;
  allKeys: string[];
  keyToSecretName: Map<string, string>;
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

  const keyToSecretName = new Map<string, string>();
  for (const key of allKeys) {
    if (keysFilter.size > 0 && !keysFilter.has(key)) {
      continue;
    }
    keyToSecretName.set(key, resolveSecretName(key, config));
  }

  appMappings.push({
    appName,
    appPath,
    envFilePath: join(ROOT_DIR, appPath, resolveEnvFile(mode)),
    allKeys,
    keyToSecretName,
    defaults: readEnvDefaults(appPath),
  });
}

// Warn about requested keys that no target app actually has
if (keysFilter.size > 0) {
  const foundKeys = new Set<string>();
  for (const m of appMappings) {
    for (const key of m.keyToSecretName.keys()) {
      foundKeys.add(key);
    }
  }
  const unmatched = [...keysFilter].filter((k) => !foundKeys.has(k));
  if (unmatched.length > 0) {
    console.warn(
      `   ⚠️  Key(s) not found in any target app's .env.example: ${unmatched.join(', ')}`,
    );
  }
}

const allSecretNames = new Set<string>();
for (const m of appMappings) {
  for (const secretName of m.keyToSecretName.values()) {
    allSecretNames.add(secretName);
  }
}

const secrets = isEmulator ? new Map<string, string>() : await sopsDecrypt(mode);
if (isEmulator) {
  console.log('   Skipping decrypt (emulator mode) — using .env.example + fake local defaults\n');
}

// Classify by the ORIGINAL local env key (the encrypted bundle's key names
// may not carry the PUBLIC_ prefix), so only local keys starting with
// PUBLIC_ are treated as public; everything else is a secret.
// NEVER_ENCRYPT_KEYS (the Tauri signing key) are excluded from "expected"
// entirely — they never live in the bundle, so their absence is never a
// --strict failure.
const secretNameToKey = new Map<string, string>();
const excludedSecretNames = new Set<string>();
for (const m of appMappings) {
  for (const [localKey, secretName] of m.keyToSecretName) {
    secretNameToKey.set(secretName, localKey);
    if (NEVER_ENCRYPT_KEYS.has(localKey)) {
      excludedSecretNames.add(secretName);
    }
  }
}
const expectedSecretNames = [...allSecretNames].filter((n) => !excludedSecretNames.has(n));
const missingNames = isEmulator ? [] : expectedSecretNames.filter((n) => !secrets.has(n));
if (missingNames.length > 0) {
  // PUBLIC_ build-config keys are optional — blank is a valid value (log
  // levels, recaptcha key, analytics ids). Never fatal, even with --strict,
  // so CI (release.yml runs --strict) isn't blocked by an unset optional.
  const missingPublic = missingNames.filter((n) => secretNameToKey.get(n)?.startsWith('PUBLIC_'));
  const missingSecret = missingNames.filter((n) => !secretNameToKey.get(n)?.startsWith('PUBLIC_'));
  if (missingPublic.length > 0) {
    console.warn(
      `   ⚠️  ${missingPublic.length} public build-config key(s) not in the bundle (stays blank/default):`,
    );
    for (const m of missingPublic) {
      console.warn(`      - ${m}`);
    }
  }
  if (missingSecret.length > 0) {
    console.warn(`   ⚠️  ${missingSecret.length} secret(s) not found in secrets/${mode}.enc.env:`);
    for (const m of missingSecret) {
      console.warn(`      - ${m}`);
    }
  }

  if (opts.strict && missingSecret.length > 0) {
    console.error(
      `\n❌ Strict mode: ${missingSecret.length} secret(s) missing from secrets/${mode}.enc.env.`,
    );
    console.error('   Failing early — the generated .env files would be incomplete.');
    console.error(
      '   Fix: run `bun run encrypt-secrets` for the missing key(s), or re-run without --strict.',
    );
    process.exit(1);
  }
}
console.log('');

// Generate .env.{mode} for each app

let totalUpdated = 0;

for (const m of appMappings) {
  if (keysFilter.size > 0 && !existsSync(m.envFilePath)) {
    // A --keys run only knows the values for the filtered key(s) — every
    // other key in allKeys has no source to fall back to but "blank" when
    // the file doesn't exist yet. Writing that out would look like a full,
    // valid .env file with everything else silently emptied. Refuse instead.
    console.error(
      `  ❌ ${m.envFilePath} doesn't exist yet — --keys can only update an existing file, not create one (would blank out every other key).`,
    );
    console.error(`     Run without --keys first to generate the full file.`);
    process.exitCode = 1;
    continue;
  }
  const existing = readExistingEnv(m.envFilePath);
  const emulatorOverrides = isEmulator ? (EMULATOR_ENV_OVERRIDES[m.appName] ?? {}) : {};
  const content = generateEnvContent(
    m.allKeys,
    existing,
    secrets,
    m.keyToSecretName,
    m.defaults,
    emulatorOverrides,
  );

  await Bun.write(m.envFilePath, content);

  if (isEmulator) {
    console.log(`  ✅ ${m.appPath}/${resolveEnvFile(mode)}`);
  } else {
    const secretKeysForApp = [...m.keyToSecretName.keys()].length;
    const updated = [...m.keyToSecretName.values()].filter((n) => secrets.has(n)).length;
    console.log(
      `  ✅ ${m.appPath}/${resolveEnvFile(mode)} — ${updated}/${secretKeysForApp} secrets decrypted`,
    );
    totalUpdated += updated;
  }
}

if (isEmulator) {
  console.log(`\n✅ Done — generated .env.emulator for ${appMappings.length} app(s).`);
} else {
  console.log(`\n✅ Done — ${totalUpdated} secret(s) written across ${appMappings.length} app(s).`);
}
