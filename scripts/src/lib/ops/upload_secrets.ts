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

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

const opts = parseCliArgs(Bun.argv.slice(2), {
  mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  'dry-run': { type: 'boolean' },
});
const mode = (opts.mode as string) || process.env.AIKAMI_MODE || process.env.MODE || '';
if (!mode) {
  console.error('❌ No mode specified. Use --mode=<mode>');
  process.exit(1);
}

const shouldUpdate = !opts['dry-run'];

const GCP_PROJECT = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
if (!GCP_PROJECT) {
  console.error(`❌ Unknown mode "${mode}".`);
  process.exit(1);
}

const positionalArgs = opts._;

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

console.log(`☁️  GCP Project: ${GCP_PROJECT}`);
console.log(`🍦 Mode: ${mode}`);
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
  console.log(`   Found ${entries.length} secrets\n`);

  for (const [key, value] of entries) {
    if (value === '') {
      console.log(`⏭️  Skipping "${key}" (empty value)`);
      totalSkipped++;
      continue;
    }

    const secretName = resolveSecretName(key, config);

    try {
      const exists = await secretExists(secretName);
      if (!exists) {
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
      console.error(
        `❌ Error processing "${secretName}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

console.log(
  `\nDone! Created ${totalCreated}, updated ${totalUpdated}, unchanged ${totalUnchanged}, skipped ${totalSkipped}.`,
);
