#!/usr/bin/env bun
// scripts/src/lib/setup/github.ts
//
// Configure GitHub repository secrets for CI deployments.
// Uploads FIREBASE_SERVICE_ACCOUNT from .env.{mode} as GCP_SA_KEY.
//
// Usage:
//   bun run scripts/src/lib/setup/github.ts --mode=staging
//   bun run scripts/src/lib/setup/github.ts --mode=production
//   bun run scripts/src/lib/setup/github.ts --mode=staging --dry-run

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmt, parseCliArgs, run } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

const REPO = 'BearlySleeping/aikami';
const ROOT = join(import.meta.dir, '../../../..');

function gh(...args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return run(['gh', ...args]).then((r) => ({ ok: r.code === 0, out: r.out, err: r.err }));
}

async function setGitHubSecret(name: string, value: string): Promise<boolean> {
  // Pass the value via stdin so it never appears in process listings
  const proc = Bun.spawn({
    cmd: ['gh', 'secret', 'set', name, '--repo', REPO],
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.stdin.write(value);
  await proc.stdin.end();
  const code = await proc.exited;
  return code === 0;
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
    console.log(fmt.err(`FIREBASE_SERVICE_ACCOUNT not found in apps/backend/firebase/.env.${mode}`));
    console.log(fmt.note('Run: bun run scripts/src/lib/ops/download_secrets.ts --mode=' + mode));
    checks.push({ name: 'FIREBASE_SERVICE_ACCOUNT', status: 'missing' });
    return { checks, uploaded: false };
  }

  console.log(fmt.ok(`Found FIREBASE_SERVICE_ACCOUNT in ${sa.envPath}`));
  if (sa.projectId) {
    console.log(fmt.note(`Service account project: ${sa.projectId}`));
  }

  // Validate it's valid JSON
  try {
    JSON.parse(sa.value);
  } catch {
    console.log(fmt.err('FIREBASE_SERVICE_ACCOUNT is not valid JSON'));
    checks.push({ name: 'FIREBASE_SERVICE_ACCOUNT', status: 'error', detail: 'Not valid JSON' });
    return { checks, uploaded: false };
  }

  // Upload as GCP_SA_KEY
  if (dryRun) {
    console.log(fmt.fix('Would upload GCP_SA_KEY secret (dry-run)'));
    checks.push({ name: 'GCP_SA_KEY', status: 'missing', fixed: true });
    return { checks, uploaded: false };
  }

  console.log(fmt.fix('Uploading GCP_SA_KEY...'));
  const ok = await setGitHubSecret('GCP_SA_KEY', sa.value);
  if (ok) {
    console.log(fmt.ok('GCP_SA_KEY uploaded'));
    checks.push({ name: 'GCP_SA_KEY', status: 'missing', fixed: true });
  } else {
    console.log(fmt.err('Failed to upload GCP_SA_KEY'));
    checks.push({ name: 'GCP_SA_KEY', status: 'error', detail: 'Upload failed' });
  }

  return { checks, uploaded: ok };
};

// ── Standalone entry ────────────────────────────────────────────────────────
if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    'dry-run': { type: 'boolean' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;

  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error(fmt.err(`Unknown mode: ${mode}`));
    process.exit(1);
  }

  console.log(fmt.head(`GitHub Secrets Setup — ${mode} (${projectId})`));
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
