#!/usr/bin/env bun
// scripts/src/lib/project_setup/iam.ts
//
// Grant IAM roles to the two service accounts behind the aikami-worker
// Compute Engine VM (see apps/backend/worker/README.md, "Infra"):
//   - Deploy SA  — firebase-adminsdk-fbsvc@<project>.iam.gserviceaccount.com.
//     Authenticates `scripts/src/lib/worker/deploy.ts` locally (via
//     .secrets/gcp_sa_key.{mode}.json) and in CI (release.yml's
//     deploy-worker job, from the SOPS-encrypted GCP_SA_KEY_JSON). Needs
//     just enough to build/push the image and roll the VM's container.
//     Still the pre-Cloudflare-migration Firebase Admin SDK key — kept as
//     the deploy identity rather than rotated, since it already has no
//     other live consumer.
//   - Runtime SA — worker@<project>.iam.gserviceaccount.com. The identity
//     the VM itself runs as (apps/backend/worker/src/secrets.ts fetches
//     Secret Manager values through it via the metadata server).
//     roles/secretmanager.secretAccessor is intentionally NOT granted
//     project-wide here. This setup scopes it to every secret the worker
//     reads so the SA can't access unrelated secrets.
//
// Usage:
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production --dry-run
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production --sa-id=custom-deploy-sa
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production --runtime-sa-id=custom-runtime-sa
//
// Caller must have `roles/resourcemanager.projectIamAdmin` (or project
// owner) on the target project — run `gcloud auth login` first.

import { c, fmt, parseCliArgs, run } from '../cli_utils';
import { liveModes, MODE_PROJECT_MAP } from '../deploy/deployment_config';
import { getWorkerRuntimeSecretIds } from './secrets_manager';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

/**
 * Roles the deploy SA needs to build/push the worker's Docker image and
 * roll out the aikami-worker VM. See scripts/src/lib/worker/deploy.ts.
 */
const DEPLOY_ROLES: Array<{ role: string; why: string }> = [
  {
    role: 'roles/artifactregistry.writer',
    why: 'docker push to the aikami-worker Artifact Registry repo',
  },
  {
    role: 'roles/compute.instanceAdmin.v1',
    why: 'gcloud compute instances update-container — redeploy the aikami-worker VM',
  },
];

/**
 * Roles the runtime SA needs on the project as a whole. Kept minimal —
 * see the file header for why secretmanager.secretAccessor is deliberately
 * excluded (granted per-secret instead).
 */
const RUNTIME_ROLES: Array<{ role: string; why: string }> = [
  {
    role: 'roles/artifactregistry.reader',
    why: 'the VM pulls its own container image from the aikami-worker repo',
  },
];

/** Project-level IAM bindings where `memberEmail` appears. */
const getProjectRoles = async (projectId: string, memberEmail: string): Promise<Set<string>> => {
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

/** Roles granted ON a service account resource to `memberEmail`. */
const getSaResourceRoles = async (
  projectId: string,
  resourceSa: string,
  memberEmail: string,
): Promise<Set<string>> => {
  const { out, code } = await run([
    'gcloud',
    'iam',
    'service-accounts',
    'get-iam-policy',
    resourceSa,
    '--project',
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

/** Grant `role` to `memberEmail` on the whole project. */
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

/** Grant `role` to `memberEmail` on the `resourceSa` service account resource. */
const addSaIamBinding = async (
  projectId: string,
  resourceSa: string,
  memberEmail: string,
  role: string,
): Promise<boolean> => {
  const { code } = await run([
    'gcloud',
    'iam',
    'service-accounts',
    'add-iam-policy-binding',
    resourceSa,
    '--project',
    projectId,
    `--member=serviceAccount:${memberEmail}`,
    `--role=${role}`,
    '--quiet',
  ]);
  return code === 0;
};

/** Roles granted on a Secret Manager secret to a service account. */
const getSecretRoles = async (options: {
  projectId: string;
  secretId: string;
  memberEmail: string;
}): Promise<Set<string>> => {
  const { projectId, secretId, memberEmail } = options;
  const { out, code } = await run([
    'gcloud',
    'secrets',
    'get-iam-policy',
    secretId,
    `--project=${projectId}`,
    '--flatten=bindings[].members',
    `--filter=bindings.members:serviceAccount:${memberEmail}`,
    '--format=json',
    '--quiet',
  ]);
  if (code !== 0) {
    return new Set();
  }
  try {
    const policies = JSON.parse(out) as Array<{ bindings?: { role: string; members: string[] } }>;
    return new Set(
      policies.flatMap((policy) => (policy.bindings?.role ? [policy.bindings.role] : [])),
    );
  } catch {
    return new Set();
  }
};

/** Grant a service account access to one Secret Manager secret. */
const addSecretIamBinding = async (options: {
  projectId: string;
  secretId: string;
  memberEmail: string;
  role: string;
}): Promise<boolean> => {
  const { projectId, secretId, memberEmail, role } = options;
  const { code } = await run([
    'gcloud',
    'secrets',
    'add-iam-policy-binding',
    secretId,
    `--project=${projectId}`,
    `--member=serviceAccount:${memberEmail}`,
    `--role=${role}`,
    '--quiet',
  ]);
  return code === 0;
};

/** Does the service account exist in the project? */
const saExists = async (projectId: string, saEmail: string): Promise<boolean> => {
  const { code } = await run([
    'gcloud',
    'iam',
    'service-accounts',
    'describe',
    saEmail,
    `--project=${projectId}`,
    '--quiet',
  ]);
  return code === 0;
};

type Grant = {
  role: string;
  why: string;
  /** Who receives the role. */
  member: string;
  /** Where the grant is scoped. */
  resource: 'project' | { serviceAccount: string };
};

/**
 * Grant the deploy + runtime service accounts their IAM roles.
 *
 * Deploy roles go to {@link deploySaEmail} on the project. Runtime project
 * roles and per-secret access go to {@link runtimeSaEmail}. `runtimeSaEmail`
 * defaults to `deploySaEmail` only when the caller doesn't pass one — in
 * practice the two are different accounts for the worker VM.
 */
export const setupIam = async (
  projectId: string,
  deploySaEmail: string,
  dryRun: boolean,
  runtimeSaEmail: string = deploySaEmail,
): Promise<{ checks: Check[] }> => {
  const checks: Check[] = [];

  // ── Service accounts exist? ─────────────────────────────────────────
  console.log(fmt.section('Service Accounts'));
  for (const [label, email] of [
    ['Deploy', deploySaEmail],
    ['Runtime', runtimeSaEmail],
  ] as const) {
    if (await saExists(projectId, email)) {
      console.log(fmt.ok(`${label}: ${c.bold}${email}${c.reset}`));
      checks.push({ name: `SA (${label}): ${email}`, status: 'ok' });
    } else {
      console.log(fmt.err(`${label} service account ${email} not found in ${projectId}`));
      checks.push({ name: `SA (${label}): ${email}`, status: 'error' });
      return { checks };
    }
  }

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
  const grants: Grant[] = [
    ...DEPLOY_ROLES.map((r) => ({
      role: r.role,
      why: r.why,
      member: deploySaEmail,
      resource: 'project' as const,
    })),
    ...RUNTIME_ROLES.map((r) => ({
      role: r.role,
      why: r.why,
      member: runtimeSaEmail,
      resource: 'project' as const,
    })),
  ];

  for (const grant of grants) {
    const scopedTo = grant.resource === 'project' ? grant.member : grant.resource.serviceAccount;
    const existing =
      grant.resource === 'project'
        ? await getProjectRoles(projectId, grant.member)
        : await getSaResourceRoles(projectId, grant.resource.serviceAccount, grant.member);

    if (existing.has(grant.role)) {
      console.log(
        fmt.ok(`${grant.role}${scopedTo !== grant.member ? ` on ${scopedTo}` : ''} — ${grant.why}`),
      );
      checks.push({ name: `IAM: ${grant.role}`, status: 'ok' });
      continue;
    }

    console.log(
      fmt.fix(`Granting ${grant.role}${scopedTo !== grant.member ? ` on ${scopedTo}` : ''}...`),
    );
    console.log(fmt.note(grant.why));
    if (dryRun) {
      console.log(fmt.fix('Would grant (dry-run)'));
      checks.push({ name: `IAM: ${grant.role}`, status: 'missing' });
      continue;
    }

    const ok =
      grant.resource === 'project'
        ? await addIamBinding(projectId, grant.member, grant.role)
        : await addSaIamBinding(projectId, grant.resource.serviceAccount, grant.member, grant.role);
    if (ok) {
      console.log(fmt.ok(`Role ${grant.role} granted`));
      checks.push({ name: `IAM: ${grant.role}`, status: 'missing', fixed: true });
    } else {
      console.log(fmt.err(`Failed to grant ${grant.role}`));
      checks.push({ name: `IAM: ${grant.role}`, status: 'error' });
    }
  }

  // ── Per-secret runtime access ───────────────────────────────────────
  console.log(fmt.section('Secret Manager Access'));
  const secretAccessorRole = 'roles/secretmanager.secretAccessor';
  for (const secretId of getWorkerRuntimeSecretIds()) {
    const existing = await getSecretRoles({ projectId, secretId, memberEmail: runtimeSaEmail });
    if (existing.has(secretAccessorRole)) {
      console.log(fmt.ok(`${secretAccessorRole} on ${secretId}`));
      checks.push({ name: `IAM: ${secretAccessorRole} on ${secretId}`, status: 'ok' });
      continue;
    }

    console.log(fmt.fix(`Granting ${secretAccessorRole} on ${secretId}...`));
    if (dryRun) {
      console.log(fmt.fix('Would grant (dry-run)'));
      checks.push({ name: `IAM: ${secretAccessorRole} on ${secretId}`, status: 'missing' });
      continue;
    }

    const ok = await addSecretIamBinding({
      projectId,
      secretId,
      memberEmail: runtimeSaEmail,
      role: secretAccessorRole,
    });
    if (ok) {
      console.log(fmt.ok(`Role ${secretAccessorRole} granted on ${secretId}`));
      checks.push({
        name: `IAM: ${secretAccessorRole} on ${secretId}`,
        status: 'missing',
        fixed: true,
      });
    } else {
      console.log(fmt.err(`Failed to grant ${secretAccessorRole} on ${secretId}`));
      checks.push({ name: `IAM: ${secretAccessorRole} on ${secretId}`, status: 'error' });
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
    'runtime-sa-id': { type: 'string' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;
  const saId = (opts['sa-id'] as string) ?? 'firebase-adminsdk-fbsvc';
  const runtimeSaId = (opts['runtime-sa-id'] as string) ?? 'worker';

  if (!liveModes.includes(mode as (typeof liveModes)[number])) {
    console.error(fmt.err(`Unknown live mode: ${mode}. Valid: ${liveModes.join(', ')}`));
    process.exit(1);
  }
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error(fmt.err(`Unknown mode: ${mode}`));
    process.exit(1);
  }
  const deploySaEmail = `${saId}@${projectId}.iam.gserviceaccount.com`;
  const runtimeSaEmail = `${runtimeSaId}@${projectId}.iam.gserviceaccount.com`;

  console.log(fmt.head(`IAM Setup — ${mode} (${projectId})`));
  console.log(`  Deploy SA:  ${deploySaEmail}`);
  console.log(`  Runtime SA: ${runtimeSaEmail}`);
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode — no changes will be made.\n'));
  }

  const { checks } = await setupIam(projectId, deploySaEmail, dryRun, runtimeSaEmail);

  const okCount = checks.filter((check) => check.status === 'ok').length;
  const fixed = checks.filter((check) => check.fixed).length;
  const errors = checks.filter((check) => check.status === 'error').length;

  console.log(fmt.head('Summary'));
  console.log(
    `  ${c.green}${okCount}${c.reset} already granted, ${c.cyan}${fixed}${c.reset} granted`,
  );
  if (errors) {
    console.log(`  ${c.red}${errors}${c.reset} errors`);
  }
  process.exit(errors > 0 ? 1 : 0);
}
