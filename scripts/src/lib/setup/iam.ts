#!/usr/bin/env bun
// scripts/src/lib/setup/iam.ts
//
// Grant IAM roles to the Aikami deploy service account
// (firebase-adminsdk-fbsvc@aikami-{project}.iam.gserviceaccount.com).
//
// The deploy pipeline (`bun run deploy`) authenticates as this SA — both
// locally (via .secrets/gcp_sa_key.{mode}.json) and in CI (GCP_SA_KEY).
// It needs permissions to push Docker images to Artifact Registry, deploy
// Cloud Run services, Firebase Hosting/Functions, and read secrets.
//
// The same SA is also the Cloud Run *runtime* identity (see cloud_run.ts —
// derived from FIREBASE_SERVICE_ACCOUNT), so the role list covers both
// deploy-time and runtime needs.
//
// Usage:
//   bun run scripts/src/lib/setup/iam.ts --mode=staging
//   bun run scripts/src/lib/setup/iam.ts --mode=production --dry-run
//   bun run scripts/src/lib/setup/iam.ts --mode=production --sa-id=custom-sa
//
// Caller must have `roles/resourcemanager.projectIamAdmin` (or project
// owner) on the target project — run `gcloud auth login` first.

import { c, fmt, parseCliArgs, run } from '../cli_utils';
import { liveModes, MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

/**
 * Roles required by the deploy pipeline + Cloud Run runtime.
 * See scripts/src/lib/deploy/*.ts for where each is exercised.
 */
const REQUIRED_ROLES: Array<{ role: string; why: string }> = [
  {
    role: 'roles/artifactregistry.writer',
    why: 'docker push/pull to Artifact Registry (hub, image, text, voice, client)',
  },
  { role: 'roles/run.developer', why: 'gcloud run deploy — deploy/update Cloud Run services' },
  {
    role: 'roles/iam.serviceAccountUser',
    why: 'act as the runtime SA when deploying Cloud Run services',
  },
  {
    role: 'roles/cloudfunctions.developer',
    why: 'deploy Firebase Functions (firestack, --deploy-engine gcloud)',
  },
  {
    role: 'roles/cloudbuild.builds.editor',
    why: 'Cloud Build jobs created during Functions deploys',
  },
  { role: 'roles/firebasehosting.admin', why: 'deploy Firebase Hosting sites (site, docs)' },
  {
    role: 'roles/secretmanager.secretAccessor',
    why: 'fetch secrets for Cloud Run --set-secrets + runtime secret reads',
  },
  { role: 'roles/logging.logWriter', why: 'Cloud Run runtime writes logs' },
  {
    role: 'roles/storage.objectAdmin',
    why: 'Firebase Hosting/Functions staging buckets + asset uploads',
  },
  {
    role: 'roles/firebase.admin',
    why: 'Firebase Admin SDK permissions (token/session-cookie verification) — usually pre-granted',
  },
];

const getMemberRoles = async (projectId: string, memberEmail: string): Promise<Set<string>> => {
  const { out, code } = await run([
    'gcloud',
    'projects',
    'get-iam-policy',
    projectId,
    '--flatten=bindings[].members',
    `--filter=bindings.members:${memberEmail}`,
    '--format=json',
    '--quiet',
  ]);
  if (code !== 0) {
    return new Set();
  }
  try {
    const policies = JSON.parse(out) as Array<{ bindings?: { role: string; members: string[] } }>;
    return new Set(policies.flatMap((p) => (p.bindings?.role ? [p.bindings.role] : [])));
  } catch {
    return new Set();
  }
};

const addIamBinding = async (
  projectId: string,
  memberEmail: string,
  role: string,
): Promise<boolean> => {
  const { code } = await run([
    'gcloud',
    'projects',
    'add-iam-policy-binding',
    projectId,
    `--member=serviceAccount:${memberEmail}`,
    `--role=${role}`,
    '--quiet',
  ]);
  return code === 0;
};

export const setupIam = async (
  projectId: string,
  saEmail: string,
  dryRun: boolean,
): Promise<{ checks: Check[] }> => {
  const checks: Check[] = [];

  // ── Service account exists? ─────────────────────────────────────────
  console.log(fmt.section('Deploy Service Account'));
  const { code: saExists } = await run([
    'gcloud',
    'iam',
    'service-accounts',
    'describe',
    saEmail,
    `--project=${projectId}`,
    '--quiet',
  ]);
  if (saExists !== 0) {
    console.log(fmt.err(`Service account ${saEmail} not found in ${projectId}`));
    checks.push({ name: `SA: ${saEmail}`, status: 'error' });
    return { checks };
  }
  console.log(fmt.ok(`Service account ${c.bold}${saEmail}${c.reset}`));
  checks.push({ name: `SA: ${saEmail}`, status: 'ok' });

  // ── Caller permission check ─────────────────────────────────────────
  const { code: policyCode } = await run([
    'gcloud',
    'projects',
    'get-iam-policy',
    projectId,
    '--flatten=bindings[].members',
    '--filter=bindings.members:user:',
    '--format=json',
    '--quiet',
  ]);
  if (policyCode !== 0) {
    console.log(fmt.err('Cannot read project IAM policy — the active account lacks'));
    console.log(fmt.note('roles/resourcemanager.projectIamAdmin (or project owner).'));
    console.log(fmt.note('Run: gcloud auth login  (as an owner of the project)'));
    checks.push({ name: 'IAM read access', status: 'error' });
    return { checks };
  }
  console.log(fmt.ok('Project IAM policy readable — grants will apply'));

  // ── IAM Roles ───────────────────────────────────────────────────────
  console.log(fmt.section('IAM Roles'));
  const existingRoles = await getMemberRoles(projectId, saEmail);

  for (const { role, why } of REQUIRED_ROLES) {
    if (existingRoles.has(role)) {
      console.log(fmt.ok(`${role} — ${why}`));
      checks.push({ name: `IAM: ${role}`, status: 'ok' });
    } else {
      console.log(fmt.fix(`Granting ${role} to ${saEmail}...`));
      console.log(fmt.note(why));
      if (!dryRun) {
        const ok = await addIamBinding(projectId, saEmail, role);
        if (ok) {
          console.log(fmt.ok(`Role ${role} granted`));
          checks.push({ name: `IAM: ${role}`, status: 'missing', fixed: true });
        } else {
          console.log(fmt.err(`Failed to grant ${role}`));
          checks.push({ name: `IAM: ${role}`, status: 'error' });
        }
      } else {
        console.log(fmt.fix(`Would grant ${role} (dry-run)`));
        checks.push({ name: `IAM: ${role}`, status: 'missing', fixed: true });
      }
    }
  }

  return { checks };
};

// ── Standalone entry ────────────────────────────────────────────────────────
if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    'dry-run': { type: 'boolean' },
    'sa-id': { type: 'string' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;
  const saId = (opts['sa-id'] as string) ?? 'firebase-adminsdk-fbsvc';

  if (!liveModes.includes(mode as (typeof liveModes)[number])) {
    console.error(fmt.err(`Unknown live mode: ${mode}. Valid: ${liveModes.join(', ')}`));
    process.exit(1);
  }
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error(fmt.err(`Unknown mode: ${mode}`));
    process.exit(1);
  }
  const saEmail = `${saId}@${projectId}.iam.gserviceaccount.com`;

  console.log(fmt.head(`IAM Setup — ${mode} (${projectId})`));
  console.log(`  Service account: ${saEmail}`);
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode — no changes will be made.\n'));
  }

  const { checks } = await setupIam(projectId, saEmail, dryRun);

  const okCount = checks.filter((c) => c.status === 'ok').length;
  const fixed = checks.filter((c) => c.fixed).length;
  const errors = checks.filter((c) => c.status === 'error').length;

  console.log(fmt.head('Summary'));
  console.log(
    `  ${c.green}${okCount}${c.reset} already granted, ${c.cyan}${fixed}${c.reset} granted`,
  );
  if (errors) {
    console.log(`  ${c.red}${errors}${c.reset} errors`);
  }
  process.exit(errors > 0 ? 1 : 0);
}
