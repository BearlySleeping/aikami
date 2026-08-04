#!/usr/bin/env bun
// scripts/src/lib/setup/github.ts
//
// Configure GitHub repository environment secrets for CI deployments.
// GCP_SA_KEY is per-environment (staging vs production use different
// service account keys), so this uploads FIREBASE_SERVICE_ACCOUNT from
// .env.{mode} as the GCP_SA_KEY secret of the matching GitHub
// environment (creating the environment if needed).
//
// Usage:
//   bun run scripts/src/lib/setup/github.ts --mode=staging
//   bun run scripts/src/lib/setup/github.ts --mode=production   (default)
//   bun run scripts/src/lib/setup/github.ts --mode=staging --dry-run

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmt, parseCliArgs, run } from '../cli_utils';
import { liveModes, MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

const REPO = 'BearlySleeping/aikami';
const ROOT = join(import.meta.dir, '../../../..');

function gh(...args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return run(['gh', ...args]).then((r) => ({ ok: r.code === 0, out: r.out, err: r.err }));
}

async function setGitHubSecret(name: string, value: string, env?: string): Promise<boolean> {
  // Pass the value via stdin so it never appears in process listings
  const args = ['secret', 'set', name, '--repo', REPO];
  if (env) {
    args.push('--env', env);
  }
  const proc = Bun.spawn({
    cmd: args,
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.stdin.write(value);
  await proc.stdin.end();
  const code = await proc.exited;
  return code === 0;
}

/** Create a GitHub environment if it does not exist yet (idempotent). */
async function ensureGitHubEnvironment(env: string): Promise<boolean> {
  const { ok } = await gh('api', '-X', 'PUT', `repos/${REPO}/environments/${env}`, '--silent');
  return ok;
}

async function readServiceAccount(mode: string): Promise<{
  value: string;
  envPath: string;
  projectId: string;
} | null> {
  const envFile = `.env.${mode}`;

  // Check firebase app's .env.{mode} first (canonical source)
  const firebaseEnvPath = join(ROOT, 'apps/backend/firebase', envFile);
  if (existsSync(firebaseEnvPath)) {
    const content = readFileSync(firebaseEnvPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FIREBASE_SERVICE_ACCOUNT=')) {
        const value = trimmed.slice('FIREBASE_SERVICE_ACCOUNT='.length);
        // Parse to extract project_id
        let projectId = '';
        try {
          projectId = JSON.parse(value).project_id ?? '';
        } catch {
          // not JSON, skip project_id extraction
        }
        return { value, envPath: firebaseEnvPath, projectId };
      }
    }
  }

  // Fallback: check root .env.{mode}
  const rootEnvPath = join(ROOT, envFile);
  if (existsSync(rootEnvPath)) {
    const content = readFileSync(rootEnvPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FIREBASE_SERVICE_ACCOUNT=')) {
        const value = trimmed.slice('FIREBASE_SERVICE_ACCOUNT='.length);
        let projectId = '';
        try {
          projectId = JSON.parse(value).project_id ?? '';
        } catch {
          // not JSON
        }
        return { value, envPath: rootEnvPath, projectId };
      }
    }
  }

  return null;
}

export const setupGitHub = async (
  mode: string,
  dryRun: boolean,
): Promise<{ checks: Check[]; uploaded: boolean }> => {
  const checks: Check[] = [];

  console.log(fmt.section('GitHub Secrets Setup'));

  // Check gh auth
  const { ok: ghOk, out: ghUser } = await gh('api', 'user', '-q', '.login');
  if (!ghOk) {
    console.log(fmt.err('GitHub CLI (gh) is not authenticated. Run: gh auth login'));
    checks.push({ name: 'GitHub auth', status: 'error' });
    return { checks, uploaded: false };
  }
  console.log(fmt.ok(`Authenticated as ${ghUser}`));

  // Check repo access
  const { ok: repoOk } = await gh('repo', 'view', REPO);
  if (!repoOk) {
    console.log(fmt.err(`Cannot access repository ${REPO}`));
    checks.push({ name: 'GitHub repo access', status: 'error' });
    return { checks, uploaded: false };
  }
  console.log(fmt.ok(`Repository ${REPO} accessible`));

  // Read FIREBASE_SERVICE_ACCOUNT
  const sa = await readServiceAccount(mode);
  if (!sa) {
    console.log(
      fmt.err(`FIREBASE_SERVICE_ACCOUNT not found in apps/backend/firebase/.env.${mode}`),
    );
    console.log(fmt.note(`Run: bun run scripts/src/lib/ops/download_secrets.ts --mode=${mode}`));
    checks.push({ name: 'FIREBASE_SERVICE_ACCOUNT', status: 'missing' });
    return { checks, uploaded: false };
  }

  console.log(fmt.ok(`Found FIREBASE_SERVICE_ACCOUNT in ${sa.envPath}`));
  if (sa.projectId) {
    console.log(fmt.note(`Service account project: ${sa.projectId}`));
  }

  // Validate it's a FULL service account key JSON (the google-github-actions
  // auth action rejects keys missing fields like `type`, `private_key_id`,
  // `token_uri`. A truncated/partial key is a silent CI breaker — fail here.)
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sa.value) as Record<string, unknown>;
  } catch {
    console.log(fmt.err('FIREBASE_SERVICE_ACCOUNT is not valid JSON'));
    checks.push({ name: 'FIREBASE_SERVICE_ACCOUNT', status: 'error', detail: 'Not valid JSON' });
    return { checks, uploaded: false };
  }
  const required = ['type', 'private_key', 'client_email', 'private_key_id', 'token_uri'];
  const missing = required.filter((k) => !parsed[k]);
  if (parsed.type !== 'service_account' || missing.length > 0) {
    console.log(
      fmt.err(
        `FIREBASE_SERVICE_ACCOUNT is not a full service account key JSON — missing: ${missing.join(', ') || "type='service_account'"}`,
      ),
    );
    console.log(fmt.note('Regenerate the key with: gcloud iam service-accounts keys create'));
    checks.push({ name: 'FIREBASE_SERVICE_ACCOUNT', status: 'error', detail: 'Incomplete key JSON' });
    return { checks, uploaded: false };
  }

  // Upload as GCP_SA_KEY on the environment matching the mode.
  const env = mode; // 'staging' | 'production'
  if (dryRun) {
    console.log(fmt.fix(`Would upload GCP_SA_KEY to environment "${env}" (dry-run)`));
    checks.push({ name: `GCP_SA_KEY (env:${env})`, status: 'missing', fixed: true });
    return { checks, uploaded: false };
  }

  console.log(fmt.fix(`Ensuring GitHub environment "${env}"...`));
  if (!(await ensureGitHubEnvironment(env))) {
    console.log(fmt.err(`Failed to create/access environment "${env}"`));
    checks.push({ name: `environment:${env}`, status: 'error' });
    return { checks, uploaded: false };
  }
  console.log(fmt.ok(`Environment "${env}" ready`));

  console.log(fmt.fix(`Uploading GCP_SA_KEY to environment "${env}"...`));
  const ok = await setGitHubSecret('GCP_SA_KEY', sa.value, env);
  if (ok) {
    console.log(fmt.ok(`GCP_SA_KEY uploaded to environment "${env}"`));
    checks.push({ name: `GCP_SA_KEY (env:${env})`, status: 'missing', fixed: true });
  } else {
    console.log(fmt.err(`Failed to upload GCP_SA_KEY to environment "${env}"`));
    checks.push({ name: `GCP_SA_KEY (env:${env})`, status: 'error', detail: 'Upload failed' });
  }

  return { checks, uploaded: ok };
};

// ── Standalone entry ────────────────────────────────────────────────────────
if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    'dry-run': { type: 'boolean' },
  });
  // Default to production — release deploys are the primary use case.
  const mode = (opts.mode as string) ?? 'production';
  const dryRun = opts['dry-run'] as boolean;

  if (!liveModes.includes(mode as (typeof liveModes)[number])) {
    console.error(fmt.err(`Unknown live mode: ${mode}. Valid: ${liveModes.join(', ')}`));
    process.exit(1);
  }

  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error(fmt.err(`Unknown mode: ${mode}`));
    process.exit(1);
  }

  console.log(fmt.head(`GitHub Environment Secrets Setup — ${mode} (${projectId})`));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode — no changes will be made.\n'));
  }

  const { checks, uploaded } = await setupGitHub(mode, dryRun);

  // Summary
  const okCount = checks.filter((c) => c.status === 'ok').length;
  const fixed = checks.filter((c) => c.fixed).length;
  const errors = checks.filter((c) => c.status === 'error').length;

  console.log(fmt.section('Summary'));
  if (okCount > 0) {
    console.log(`  ${okCount} already configured`);
  }
  if (fixed > 0) {
    console.log(`  ${fixed} fixed`);
  }
  if (errors > 0) {
    console.log(`  ${errors} errors`);
  }

  if (uploaded) {
    console.log(fmt.ok(`CI deployments via ${projectId} service account are ready.\n`));
  }

  process.exit(errors > 0 ? 1 : 0);
}
