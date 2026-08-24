#!/usr/bin/env bun
// scripts/src/lib/ops/upload_secrets.ts
//
// Upload secrets from .env.{mode} files to GCP Secret Manager.
//
// Reads each app's `.env.{mode}` file and uploads the values as secrets.
// App-specific keys (defined in APP_SPECIFIC_KEYS_FOR_PREFIX) are prefixed
// with the project's prefix. By default, existing secrets are updated when
// values differ. Use --dry-run to preview without changing.
//
// Usage:
//   bun run upload-secrets --mode=staging
//   bun run upload-secrets --mode=staging client site
//   bun run upload-secrets --mode=staging --keys GEMINI_API_KEY   # only those keys
//   bun run upload-secrets --mode=staging all
//   bun run upload-secrets --mode=staging --dry-run

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, parseEnvFile } from '../cli_utils';
import {
  APP_SPECIFIC_KEYS_FOR_PREFIX,
  MODE_PROJECT_MAP,
  PROJECT_ENV_CONFIG,
  resolveEnvFile,
  resolveSecretName,
} from '../deploy/deployment_config';
import {
  resolveBackend,
  sopsEncrypt,
  type SecretsBackend,
} from './secrets_backend';

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

const shouldUpdate = !opts['dry-run'];

const backend: SecretsBackend = resolveBackend();

const GCP_PROJECT = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
if (!GCP_PROJECT) {
  console.error(`❌ Unknown mode "${mode}".`);
  process.exit(1);
}

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

async function secretExists(secretName: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ['gcloud', 'secrets', 'describe', secretName, `--project=${GCP_PROJECT}`, '--quiet'],
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const code = await proc.exited;
  return code === 0;
}

async function getSecretValue(secretName: string): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: [
      'gcloud',
      'secrets',
      'versions',
      'access',
      'latest',
      `--secret=${secretName}`,
      `--project=${GCP_PROJECT}`,
      '--quiet',
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    return null;
  }
  return out.trim();
}

async function createSecret(secretName: string, value: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: [
      'gcloud',
      'secrets',
      'create',
      secretName,
      `--project=${GCP_PROJECT}`,
      '--data-file=-',
      '--quiet',
    ],
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.stdin.write(value);
  await proc.stdin.end();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to create secret "${secretName}"`);
  }
}

async function updateSecret(secretName: string, value: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: [
      'gcloud',
      'secrets',
      'versions',
      'add',
      secretName,
      `--project=${GCP_PROJECT}`,
      '--data-file=-',
      '--quiet',
    ],
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.stdin.write(value);
  await proc.stdin.end();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to update secret "${secretName}"`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
const projectNames = getTargetProjects();

if (projectNames.length === 0) {
  console.error('❌ No projects to upload.');
  process.exit(1);
}

if (backend === 'sops') {
  console.log(`🔐 Backend: SOPS (secrets/${mode}.enc.env)`);
} else {
  console.log(`☁️  GCP Project: ${GCP_PROJECT}`);
}
console.log(`🍦 Mode: ${mode}`);
if (keysFilter.size > 0) {
  console.log(`🔑 Keys: ${[...keysFilter].join(', ')} (filtered)`);
}
console.log(`📁 Projects: ${projectNames.join(', ')}`);
if (shouldUpdate) {
  console.log('🔄 Update mode: secrets with changed values will be updated');
} else {
  console.log('⏭️  Dry-run mode: remove --dry-run to update');
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

let totalCreated = 0;
let totalUpdated = 0;
let totalUnchanged = 0;
let totalSkipped = 0;
let totalFailed = 0;

// Track which local .env keys actually made it into the deduped set (for --keys validation)
const collectedLocalKeys = new Set<string>();

// Collect every (resolved secret name → value) across all target projects, then
// dedupe by the GSM secret name — same optimization as the download script,
// which merges all apps into one Set before batch-fetching. Shared secrets
// (MODE, REDIS_URL, PUBLIC_MODE, …) appear in several apps' .env files but only
// need one gcloud round-trip; the cross-app mismatch check above guarantees the
// values are consistent, and client/client-tauri share the same env file.
// Result: 1× secretExists + 1× getSecretValue per unique secret instead of per
// occurrence (N apps sharing a secret previously cost 2N gcloud calls).
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
      // Skip it so a stale local value never overwrites anything in GSM.
      console.log(`⏭️  Skipping "${key}" (legacy Firebase key — no longer used)`);
      totalSkipped++;
      continue;
    }

    const secretName = resolveSecretName(key, config);
    collectedLocalKeys.add(key);
    const existing = deduped.get(secretName);
    if (existing) {
      if (existing.value !== value) {
        // Same GSM secret fed by two apps with different values. Normally
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
      continue; // already collected — deduped, no extra gcloud calls
    }
    deduped.set(secretName, { secretName, value, sources: [projectName] });
  }
}

console.log(
  `\n   ${deduped.size} unique secret(s) across ${projectNames.length} project(s)` +
    ` — one gcloud round-trip each (previously: one per occurrence).\n`,
);

// Warn about requested keys that no processed .env file actually contained
if (keysFilter.size > 0) {
  const unmatched = [...keysFilter].filter((k) => !collectedLocalKeys.has(k));
  if (unmatched.length > 0) {
    console.warn(
      `   ⚠️  Key(s) not found in any processed .env.${mode} file: ${unmatched.join(', ')}`,
    );
  }
}

if (backend === 'sops') {
  // SOPS backend: collect all unique values and encrypt to a single file
  const allSecrets = new Map<string, string>();
  for (const { secretName, value } of deduped.values()) {
    allSecrets.set(secretName, value);
  }

  if (allSecrets.size === 0) {
    console.log('\n⏭️  No secrets to encrypt.');
  } else {
    const written = await sopsEncrypt(mode, allSecrets);
    if (written) {
      console.log(`\n✅ Encrypted ${allSecrets.size} secret(s) to secrets/${mode}.enc.env`);
    } else {
      console.log(`\n⏭️  No changes — secrets/${mode}.enc.env is up to date.`);
    }
  }
} else {
  for (const { secretName, value } of deduped.values()) {
    try {
      const exists = await secretExists(secretName);
      if (!exists) {
        if (!shouldUpdate) {
          console.log(`⏭️  Would create "${secretName}" (dry-run)`);
          totalSkipped++;
          continue;
        }
        await createSecret(secretName, value);
        console.log(`✅ Created "${secretName}"`);
        totalCreated++;
        continue;
      }

      const currentValue = await getSecretValue(secretName);
      if (currentValue === value) {
        console.log(`⏭️  Skipping "${secretName}" (already up to date)`);
        totalUnchanged++;
        continue;
      }

      if (shouldUpdate) {
        await updateSecret(secretName, value);
        console.log(`🔄 Updated "${secretName}" (value changed)`);
        totalUpdated++;
      } else {
        console.log(`⏭️  Skipping "${secretName}" (value differs, run without --dry-run)`);
        totalSkipped++;
      }
    } catch (err) {
      console.error(`❌ Error processing "${secretName}":`, err instanceof Error ? err.message : err);
      totalFailed++;
    }
  }

  console.log(
    `\nDone! Created ${totalCreated}, updated ${totalUpdated}, unchanged ${totalUnchanged}, skipped ${totalSkipped}, failed ${totalFailed}.`,
  );
}
