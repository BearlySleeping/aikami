#!/usr/bin/env bun
// scripts/src/lib/project_setup/secrets_manager.ts
//
// Create GCP Secret Manager placeholders for the aikami-worker VM's
// runtime secrets, discovered from apps/backend/worker/.env.example.
//
// This is the ONLY app that still reads secrets from GCP Secret Manager —
// apps/backend/worker/src/secrets.ts fetches them at runtime via the VM's
// own service-account identity (see that app's README). Every other app's
// secrets moved to the SOPS/age-encrypted bundle (C-441) and never touch
// GCP. Deliberately scoped to `worker` rather than iterating
// PROJECT_ENV_CONFIG (which also includes long-gone Cloud Run/Firebase
// apps and, worse, is keyed off `enabled` — `worker` itself is
// `enabled: false` in deployment_config.ts for unrelated reasons, so that
// loop would silently skip the one app that actually needs this).
//
// GCP_SA_KEY_JSON and the WORKER_TLS_CERT/WORKER_TLS_KEY pair are
// deliberately not covered here — see the file header comments in
// apps/backend/worker/.env.example for why (deploy-time-only credential,
// and multi-line PEM values respectively).
//
// Usage:
//   bun run scripts/src/lib/project_setup/secrets_manager.ts --mode=production
//   bun run scripts/src/lib/project_setup/secrets_manager.ts --mode=production --dry-run

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmt, parseCliArgs, run } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

const ROOT = join(import.meta.dir, '../../../..');
const WORKER_APP_PATH = 'apps/backend/worker';

/** Keys the worker never reads from Secret Manager, even though they appear in its .env.example. */
const NON_SECRET_MANAGER_KEYS = new Set(['GCP_SA_KEY_JSON']);

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
    if (!key.startsWith('PUBLIC_') && !NON_SECRET_MANAGER_KEYS.has(key)) {
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

  // Worker secrets are read back by their raw .env.example key name — see
  // src/secrets.ts's fetchSecret(name) — no prefix is ever applied.
  const allGsmNames = new Set(discoverSecretKeys(WORKER_APP_PATH));

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
