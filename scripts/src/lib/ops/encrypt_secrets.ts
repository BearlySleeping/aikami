#!/usr/bin/env bun
// scripts/src/lib/ops/encrypt_secrets.ts
//
// Encrypt secrets from each app's .env.{mode} file into secrets/{mode}.enc.env.
//
// Reads each app's `.env.{mode}` file, dedupes values across apps by their
// resolved secret name, and encrypts the result with SOPS. Use --dry-run to
// preview without writing.
//
// Usage:
//   bun run encrypt-secrets --mode=staging
//   bun run encrypt-secrets --mode=staging client site
//   bun run encrypt-secrets --mode=staging --keys GEMINI_API_KEY   # only those keys
//   bun run encrypt-secrets --mode=staging all
//   bun run encrypt-secrets --mode=staging --dry-run

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modes } from '@aikami/constants';
import { parseCliArgs, parseEnvFile } from '../cli_utils';
import {
  APP_SPECIFIC_KEYS_FOR_PREFIX,
  PROJECT_ENV_CONFIG,
  resolveEnvFile,
  resolveSecretName,
} from '../deploy/deployment_config';
import { NEVER_ENCRYPT_KEYS, sopsEncrypt } from './secrets_backend';

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

const opts = parseCliArgs(Bun.argv.slice(2), {
  mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  'dry-run': { type: 'boolean' },
  keys: {
    type: 'string',
    description: 'Only process these env keys (comma-separated), e.g. --keys GEMINI_API_KEY,MODE',
  },
});
const mode = (opts.mode as string) || process.env.AIKAMI_MODE || process.env.MODE || '';
if (!mode) {
  console.error('❌ No mode specified. Use --mode=<mode>');
  process.exit(1);
}
if (!(modes as readonly string[]).includes(mode)) {
  console.error(`❌ Unknown mode "${mode}". Valid: ${modes.join(', ')}`);
  process.exit(1);
}

const isDryRun = !!opts['dry-run'];

const positionalArgs = opts._;

/** Optional filter: only process these .env keys (empty = all). */
const keysFilter = new Set(
  (opts.keys as string | undefined)
    ?.split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0) ?? [],
);

function getTargetProjects(): string[] {
  const allProjectNames = Object.keys(PROJECT_ENV_CONFIG);

  if (positionalArgs.length === 0) {
    return Object.entries(PROJECT_ENV_CONFIG)
      .filter(([, config]) => config.enabled !== false)
      .map(([name]) => name);
  }

  if (positionalArgs.length === 1 && positionalArgs[0] === 'all') {
    return allProjectNames;
  }

  const invalid = positionalArgs.filter((p) => !allProjectNames.includes(p));
  if (invalid.length > 0) {
    console.error(`❌ Invalid project(s): ${invalid.join(', ')}`);
    process.exit(1);
  }

  return positionalArgs;
}

// ── Main ────────────────────────────────────────────────────────────────────
const projectNames = getTargetProjects();

if (projectNames.length === 0) {
  console.error('❌ No projects to encrypt.');
  process.exit(1);
}

console.log(`🔐 Target: secrets/${mode}.enc.env`);
console.log(`🍦 Mode: ${mode}`);
if (keysFilter.size > 0) {
  console.log(`🔑 Keys: ${[...keysFilter].join(', ')} (filtered)`);
}
console.log(`📁 Projects: ${projectNames.join(', ')}`);
if (isDryRun) {
  console.log('⏭️  Dry-run mode: remove --dry-run to write');
}

// Cross-app mismatch detection (non-prefixed keys must have same value across apps)
if (projectNames.length > 1) {
  const crossAppValues = new Map<string, Map<string, string>>();

  for (const projectName of projectNames) {
    const config = PROJECT_ENV_CONFIG[projectName];
    if (!config) {
      continue;
    }
    const envFilePath = join(ROOT_DIR, config.path, resolveEnvFile(mode));
    let secrets: Record<string, string>;
    try {
      secrets = await parseEnvFile(envFilePath);
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(secrets)) {
      if (value === '') {
        continue;
      }
      if (keysFilter.size > 0 && !keysFilter.has(key)) {
        continue;
      }
      if (APP_SPECIFIC_KEYS_FOR_PREFIX.has(key)) {
        continue;
      }
      let appMap = crossAppValues.get(key);
      if (!appMap) {
        appMap = new Map();
        crossAppValues.set(key, appMap);
      }
      appMap.set(projectName, value);
    }
  }

  const mismatches: string[] = [];
  for (const [key, appMap] of crossAppValues) {
    const uniqueValues = new Set(appMap.values());
    if (uniqueValues.size > 1) {
      const details = [...appMap.entries()]
        .map(([app, val]) => `  ${app}: ${val.slice(0, 80)}${val.length > 80 ? '…' : ''}`)
        .join('\n');
      mismatches.push(`❌ Secret mismatch for "${key}":\n${details}`);
    }
  }

  if (mismatches.length > 0) {
    console.error(
      `\n🚫 Cross-app secret mismatches detected!\n` +
        `These keys must have the same value across all apps. ` +
        `Update the .env.${mode} files to match, then re-run.\n\n` +
        mismatches.join('\n\n') +
        '\n',
    );
    process.exit(1);
  }
}

let totalSkipped = 0;

// Track which local .env keys actually made it into the deduped set (for --keys validation)
const collectedLocalKeys = new Set<string>();

// Collect every (resolved secret name → value) across all target projects, then
// dedupe by the resolved secret name — shared keys (MODE, REDIS_URL,
// PUBLIC_MODE, …) appear in several apps' .env files but only need one entry;
// the cross-app mismatch check above guarantees the values are consistent.
type SecretEntry = { secretName: string; value: string; sources: string[] };

const deduped = new Map<string, SecretEntry>();

for (const projectName of projectNames) {
  const config = PROJECT_ENV_CONFIG[projectName];
  if (!config) {
    console.error(`❌ Config not found for "${projectName}"`);
    continue;
  }

  const envFile = resolveEnvFile(mode);
  const envFilePath = join(ROOT_DIR, config.path, envFile);

  console.log(`\n📄 Processing ${projectName} (${config.path})...`);

  let secrets: Record<string, string>;
  try {
    secrets = await parseEnvFile(envFilePath);
  } catch (err) {
    console.error(`❌ Failed to read ${envFilePath}: ${err}`);
    continue;
  }

  const entries = Object.entries(secrets);
  console.log(`   Found ${entries.length} secrets`);

  for (const [key, value] of entries) {
    if (value === '') {
      console.log(`⏭️  Skipping "${key}" (empty value)`);
      totalSkipped++;
      continue;
    }

    if (keysFilter.size > 0 && !keysFilter.has(key)) {
      continue; // not in the requested --keys filter — left untouched
    }

    if (key === 'FIREBASE_SERVICE_ACCOUNT') {
      // Legacy key — no longer used after the Firebase→Cloudflare migration.
      console.log(`⏭️  Skipping "${key}" (legacy Firebase key — no longer used)`);
      totalSkipped++;
      continue;
    }

    if (NEVER_ENCRYPT_KEYS.has(key)) {
      // 🔴 Never write the Tauri signing key to the public repo, encrypted
      // or not — see NEVER_ENCRYPT_KEYS. It reaches CI as a GitHub Actions
      // secret injected directly as a step env var instead.
      console.log(`⏭️  Skipping "${key}" (never encrypted — see NEVER_ENCRYPT_KEYS)`);
      totalSkipped++;
      continue;
    }

    const secretName = resolveSecretName(key, config);
    collectedLocalKeys.add(key);
    const existing = deduped.get(secretName);
    if (existing) {
      if (existing.value !== value) {
        // Same secret name fed by two apps with different values. Normally
        // caught by the cross-app mismatch check (non-prefixed keys), but a
        // prefixed-key collision (two apps sharing a prefix) would land here.
        const detail = [
          ...existing.sources.map(
            (app) =>
              `  ${app}: ${existing.value.slice(0, 80)}${existing.value.length > 80 ? '…' : ''}`,
          ),
          `  ${projectName}: ${value.slice(0, 80)}${value.length > 80 ? '…' : ''}`,
        ].join('\n');
        console.error(`\n🚫 Conflicting values for shared secret "${secretName}":\n${detail}\n`);
        process.exit(1);
      }
      existing.sources.push(projectName);
      continue; // already collected — deduped
    }
    deduped.set(secretName, { secretName, value, sources: [projectName] });
  }
}

console.log(`\n   ${deduped.size} unique secret(s) across ${projectNames.length} project(s).\n`);

// Warn about requested keys that no processed .env file actually contained
if (keysFilter.size > 0) {
  const unmatched = [...keysFilter].filter((k) => !collectedLocalKeys.has(k));
  if (unmatched.length > 0) {
    console.warn(
      `   ⚠️  Key(s) not found in any processed .env.${mode} file: ${unmatched.join(', ')}`,
    );
  }
}

const allSecrets = new Map<string, string>();
for (const { secretName, value } of deduped.values()) {
  allSecrets.set(secretName, value);
}

if (allSecrets.size === 0) {
  console.log('\n⏭️  No secrets to encrypt.');
} else if (isDryRun) {
  console.log(
    `\n⏭️  Would merge ${allSecrets.size} secret(s) from this run into secrets/${mode}.enc.env (dry-run)`,
  );
} else {
  // sopsEncrypt merges onto the existing bundle — a scoped run (e.g. `hub`
  // only) updates just these keys and leaves every other app's keys in the
  // shared bundle untouched.
  const written = await sopsEncrypt({ mode, secrets: allSecrets });
  if (written) {
    console.log(
      `\n✅ Merged ${allSecrets.size} secret(s) from this run into secrets/${mode}.enc.env`,
    );
  } else {
    console.log(`\n⏭️  No changes — secrets/${mode}.enc.env is up to date.`);
  }
}

if (totalSkipped > 0) {
  console.log(`\nSkipped ${totalSkipped} key(s) (empty, legacy, or never-encrypted).`);
}
