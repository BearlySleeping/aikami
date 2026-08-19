#!/usr/bin/env bun
// scripts/src/lib/project_setup/iam.ts
//
// Grant IAM roles to the Aikami deploy + runtime service accounts.
//
// Identity model (deploy-time vs runtime):
//   - Deploy SA  — authenticates `bun run deploy` locally (via
//     .secrets/gcp_sa_key.{mode}.json) and in CI (GCP_SA_KEY). Needs
//     deployment permissions only.
//   - Runtime SA — the identity Cloud Run runs AS (derived from
//     FIREBASE_SERVICE_ACCOUNT's client_email in hub's .env.{mode}).
//     Needs runtime permissions only (secret reads, log writes, Firebase
//     Admin SDK).
//
// Today both default to the same account
// (firebase-adminsdk-fbsvc@<project>.iam.gserviceaccount.com) so the
// current keys/CI secret keep working unchanged. To actually split them,
// create a deployment-only SA key (e.g. --sa-id=aikami-deploy), save it
// as .secrets/gcp_sa_key.{mode}.json + CI GCP_SA_KEY, and re-run this
// script — deployment roles are granted only to the deploy SA, runtime
// roles only to the runtime SA, and roles/iam.serviceAccountUser is
// scoped to the runtime SA resource rather than the whole project.
//
// Usage:
//   bun run scripts/src/lib/project_setup/iam.ts --mode=staging
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production --dry-run
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production --sa-id=custom-deploy-sa
//   bun run scripts/src/lib/project_setup/iam.ts --mode=production --runtime-sa-id=custom-runtime-sa
//
// Caller must have `roles/resourcemanager.projectIamAdmin` (or project
// owner) on the target project — run `gcloud auth login` first.

import { c, fmt, parseCliArgs, run } from '../cli_utils';
import { liveModes, MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

/**
 * Roles the deploy pipeline needs (Docker push, Cloud Run/Functions/
 * Hosting deploys, storage). Granted to the DEPLOY service account on the
 * project. See scripts/src/lib/deploy/*.ts for where each is exercised.
 */
const DEPLOY_ROLES: Array<{ role: string; why: string }> = [
  {
    role: 'roles/artifactregistry.writer',
    why: 'docker push/pull to Artifact Registry (hub, image, text, voice, client)',
  },
  { role: 'roles/run.developer', why: 'gcloud run deploy — deploy/update Cloud Run services' },
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
    role: 'roles/storage.objectAdmin',
    why: 'Firebase Hosting/Functions staging buckets + asset uploads',
  },
  {
    role: 'roles/secretmanager.admin',
    why: 'create/update/read secrets in GSM (bun run upload-secrets, download-secrets)',
  },
];

/**
 * Roles the Cloud Run RUNTIME needs (the identity deployed services run
 * as). Granted to the RUNTIME service account on the project — kept
 * deliberately smaller than the deploy role set.
 */
const RUNTIME_ROLES: Array<{ role: string; why: string }> = [
  {
    role: 'roles/secretmanager.secretAccessor',
    why: 'runtime secret reads (Cloud Run --set-secrets values)',
  },
  { role: 'roles/logging.logWriter', why: 'Cloud Run runtime writes logs' },
  {
    role: 'roles/firebase.admin',
    why: 'Firebase Admin SDK permissions (token/session-cookie verification) — usually pre-granted',
  },
];

/**
 * Impersonation role: lets the deploy SA act as the runtime SA when
 * deploying Cloud Run services (gcloud run deploy --service-account).
 * Scoped to the runtime SA resource instead of the whole project.
 */
const SERVICE_ACCOUNT_USER_ROLE = {
  role: 'roles/iam.serviceAccountUser',
  why: 'act as the runtime SA when deploying Cloud Run services',
} as const;

/**
 * Token creator role for the runtime SA: lets it sign JWTs via IAM
 * (iam.serviceAccounts.signBlob) for Admin SDK createCustomToken.
 * Scoped to the runtime SA resource itself (self-impersonation).
 */
const RUNTIME_SA_TOKEN_CREATOR_ROLE = {
  role: 'roles/iam.serviceAccountTokenCreator',
  why: 'Admin SDK createCustomToken signs JWTs via IAM (iam.serviceAccounts.signBlob) — required for device-link handoff tokens',
} as const;

/**
 * Token creator role for the Cloud Functions runtime SA. 2nd-gen Cloud
 * Functions run as the project's compute default SA
 * (`<projectNumber>-compute@developer.gserviceaccount.com`) unless a
 * serviceAccount is set on the function — so this separate grant is what
 * actually fixes `createCustomToken` in the deployed callables (auth,
 * poll_device_handoff), which sign JWTs through IAM
 * (`iam.serviceAccounts.signBlob`). Scoped to the compute SA resource
 * itself (self-impersonation).
 */
const FUNCTIONS_RUNTIME_SA_TOKEN_CREATOR_ROLE = {
  role: 'roles/iam.serviceAccountTokenCreator',
  why: 'Cloud Functions runtime SA (compute default) signs custom tokens via Admin SDK createCustomToken (iam.serviceAccounts.signBlob)',
} as const;

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
 * Deploy roles go to {@link deploySaEmail} on the project; runtime roles
 * go to {@link runtimeSaEmail} on the project; and
 * roles/iam.serviceAccountUser is granted on the runtime SA resource
 * (scoped) so the deploy SA can act as the runtime SA when deploying
 * Cloud Run services. Defaults both identities to the same account to
 * preserve the current single-key setup.
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

  // Cloud Functions default runtime SA = compute default SA
  // (<projectNumber>-compute@developer.gserviceaccount.com). Resolved
  // dynamically so it stays correct if the project number ever changes.
  const { out: projectNumberRaw, code: projectNumberCode } = await run([
    'gcloud',
    'projects',
    'describe',
    projectId,
    '--format=value(projectNumber)',
    '--quiet',
  ]);
  const projectNumber = projectNumberRaw.trim();
  if (projectNumberCode !== 0 || !/^\d+$/.test(projectNumber)) {
    console.log(
      fmt.err(`Could not resolve project number for ${projectId} (got "${projectNumber}")`),
    );
    checks.push({ name: 'Functions runtime SA: project number', status: 'error' });
    return { checks };
  }
  const functionsRuntimeSaEmail = `${projectNumber}-compute@developer.gserviceaccount.com`;
  console.log(`  Functions runtime SA: ${functionsRuntimeSaEmail}`);

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
    {
      role: SERVICE_ACCOUNT_USER_ROLE.role,
      why: SERVICE_ACCOUNT_USER_ROLE.why,
      member: deploySaEmail,
      resource: { serviceAccount: runtimeSaEmail },
    },
    {
      role: RUNTIME_SA_TOKEN_CREATOR_ROLE.role,
      why: RUNTIME_SA_TOKEN_CREATOR_ROLE.why,
      member: runtimeSaEmail,
      resource: { serviceAccount: runtimeSaEmail },
    },
    {
      role: FUNCTIONS_RUNTIME_SA_TOKEN_CREATOR_ROLE.role,
      why: FUNCTIONS_RUNTIME_SA_TOKEN_CREATOR_ROLE.why,
      member: functionsRuntimeSaEmail,
      resource: { serviceAccount: functionsRuntimeSaEmail },
    },
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
  const runtimeSaId = (opts['runtime-sa-id'] as string) ?? saId;

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
