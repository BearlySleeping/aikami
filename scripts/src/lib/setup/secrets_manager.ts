#!/usr/bin/env bun
// scripts/src/lib/setup/secrets_manager.ts
//
// Create GCP Secret Manager secrets from .env.example discovery.
//
// Usage:
//   bun run scripts/src/lib/setup/secrets_manager.ts --mode=staging
//   bun run scripts/src/lib/setup/secrets_manager.ts --mode=production --dry-run

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmt, parseCliArgs, run } from '../cli_utils';
import {
  MODE_PROJECT_MAP,
  PROJECT_ENV_CONFIG,
  resolveSecretName,
} from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

const ROOT = join(import.meta.dir, '../../../..');

function discoverSecretKeys(appPath: string): string[] {
  const envPath = join(ROOT, appPath, '.env.example');
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
    const key = trimmed.slice(0, eq);
    if (!key.startsWith('PUBLIC_') && key !== 'FIREBASE_SERVICE_ACCOUNT') {
      keys.push(key);
    }
  }
  return [...new Set(keys)];
}

async function checkSecret(projectId: string, secretId: string): Promise<boolean> {
  const { code } = await run([
    'gcloud',
    'secrets',
    'describe',
    secretId,
    `--project=${projectId}`,
    '--format=json',
    '--quiet',
  ]);
  return code === 0;
}

async function createSecretPlaceholder(projectId: string, secretId: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: [
      'gcloud',
      'secrets',
      'create',
      secretId,
      `--project=${projectId}`,
      '--replication-policy=automatic',
      '--data-file=-',
      '--quiet',
    ],
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.stdin.write('PLACEHOLDER');
  await proc.stdin.end();
  const code = await proc.exited;
  return code === 0;
}

export const setupSecrets = async (
  projectId: string,
  dryRun: boolean,
): Promise<{ checks: Check[]; manualSteps: ManualStep[] }> => {
  const checks: Check[] = [];
  const manualSteps: ManualStep[] = [];

  console.log(fmt.section('Secret Manager'));

  const allGsmNames = new Set<string>();
  for (const config of Object.values(PROJECT_ENV_CONFIG)) {
    if (!config.enabled) {
      continue;
    }
    const keys = discoverSecretKeys(config.path);
    for (const key of keys) {
      allGsmNames.add(resolveSecretName(key, config));
    }
  }

  for (const secretId of allGsmNames) {
    const exists = await checkSecret(projectId, secretId);
    if (exists) {
      console.log(fmt.ok(`Secret: ${secretId}`));
      checks.push({ name: `Secret: ${secretId}`, status: 'ok' });
    } else {
      console.log(fmt.fix(`Creating placeholder: ${secretId}...`));
      if (!dryRun) {
        const ok = await createSecretPlaceholder(projectId, secretId);
        if (ok) {
          console.log(fmt.ok(`Created (fill in real value)`));
          checks.push({ name: `Secret: ${secretId}`, status: 'missing', fixed: true });
        } else {
          checks.push({ name: `Secret: ${secretId}`, status: 'error' });
        }
      } else {
        console.log(fmt.fix(`Would create (dry-run)`));
        checks.push({ name: `Secret: ${secretId}`, status: 'missing', fixed: true });
      }
      manualSteps.push({
        title: `Fill in secret: ${secretId}`,
        commands: [
          `echo -n "REAL_VALUE" | gcloud secrets versions add ${secretId} --project=${projectId} --data-file=-`,
        ],
        detail: 'Replace REAL_VALUE with the actual secret.',
      });
    }
  }

  return { checks, manualSteps };
};

if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string' },
    'dry-run': { type: 'boolean' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error('Unknown mode');
    process.exit(1);
  }

  console.log(fmt.head(`Secret Manager — ${mode} (${projectId})`));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode.\n'));
  }
  await setupSecrets(projectId, dryRun);
}
