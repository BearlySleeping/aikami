// scripts/src/lib/ops/download_sa_key.ts
//
// Fetch FIREBASE_SERVICE_ACCOUNT from GCP Secret Manager and materialize it
// as .secrets/gcp_sa_key.{mode}.json — the file the deploy pipeline
// (ensureGcloudAuth in scripts/src/lib/deploy/utils.ts) and the gcloud_exec
// pi extension fall back to when no interactive `gcloud auth login` exists.
//
// The SA key JSON is stored in GSM under the `FIREBASE_SERVICE_ACCOUNT`
// secret (upload_secrets pushes it from apps/backend/firebase/.env.{mode});
// download_secrets.ts pulls it back into .env.{mode}. This script mirrors
// that fetch but writes the key to the .secrets/ path the deploy tooling
// expects, so no manual copy-paste from the env file is needed.
//
// Usage:
//   bun run scripts/src/lib/ops/download_sa_key.ts                        # production (default)
//   bun run scripts/src/lib/ops/download_sa_key.ts --mode=staging
//   bun run scripts/src/lib/ops/download_sa_key.ts --mode=production --dry-run

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fmt, parseCliArgs } from '../cli_utils';
import { MODE_PROJECT_MAP, resolveSecretName } from '../deploy/deployment_config';

const SECRET_KEY = 'FIREBASE_SERVICE_ACCOUNT';
const ROOT_DIR = resolve(join(import.meta.dir, '../../../..'));

type DownloadSaKeyArgs = {
  mode: string;
  dryRun: boolean;
  projectId: string;
  secretName: string;
};

/** Parse CLI args, resolve mode → GCP project, and derive the GSM secret name. */
const parseArgs = (): DownloadSaKeyArgs => {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    'dry-run': { type: 'boolean' },
  });
  const mode =
    (opts.mode as string | undefined) ??
    process.env.AIKAMI_MODE ??
    process.env.MODE ??
    'production';
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error(
      fmt.err(`Unknown mode "${mode}". Valid: ${Object.keys(MODE_PROJECT_MAP).join(', ')}`),
    );
    process.exit(1);
  }
  // FIREBASE_SERVICE_ACCOUNT is not in APP_SPECIFIC_KEYS_FOR_PREFIX, so
  // resolveSecretName returns it unchanged — using it keeps this correct if
  // that set ever changes.
  return {
    mode,
    dryRun: opts['dry-run'] as boolean,
    projectId,
    secretName: resolveSecretName(SECRET_KEY, { prefix: 'FIREBASE' }),
  };
};

/** Ensure gcloud is authenticated (user credentials or activated SA). */
const checkGcloudAvailable = async (): Promise<void> => {
  const proc = Bun.spawn({
    cmd: ['gcloud', 'auth', 'print-access-token', '--quiet'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(fmt.err('gcloud is not authenticated. Run: gcloud auth login'));
    process.exit(1);
  }
};

/** Fetch the latest version of the SA key secret from GSM. */
const fetchSecret = async (args: DownloadSaKeyArgs): Promise<string> => {
  const proc = Bun.spawn({
    cmd: [
      'gcloud',
      'secrets',
      'versions',
      'access',
      'latest',
      `--secret=${args.secretName}`,
      `--project=${args.projectId}`,
      '--quiet',
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    const firstLine = err.trim().split('\n')[0] ?? 'unknown error';
    console.error(fmt.err(`Failed to fetch secret "${args.secretName}": ${firstLine}`));
    process.exit(1);
  }
  return out.trim();
};

/**
 * Validate the fetched value is a full service-account key JSON.
 * Exits non-zero (refusing to write) when it isn't.
 */
const validateKey = (raw: string, args: DownloadSaKeyArgs): Record<string, unknown> => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error(fmt.err(`${args.secretName} is not valid JSON — refusing to write.`));
    process.exit(1);
  }
  if (parsed.type !== 'service_account') {
    console.error(
      fmt.err(`${args.secretName} is not a service account key (type="${String(parsed.type)}").`),
    );
    process.exit(1);
  }
  return parsed;
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const outputPath = join(ROOT_DIR, '.secrets', `gcp_sa_key.${args.mode}.json`);

  console.log(fmt.section(`Service Account Key — ${args.mode} (${args.projectId})`));

  if (args.dryRun) {
    console.log(fmt.note('Dry-run — no gcloud calls, nothing written.'));
    console.log(fmt.fix(`Would fetch ${args.secretName} → ${outputPath}`));
    return;
  }

  await checkGcloudAvailable();

  console.log(`  Fetching ${args.secretName}...`);
  const raw = await fetchSecret(args);
  const key = validateKey(raw, args);

  const keyProjectId = String(key.project_id ?? '');
  if (keyProjectId && keyProjectId !== args.projectId) {
    console.warn(
      fmt.warn(
        `Secret project_id "${keyProjectId}" does not match mode project "${args.projectId}" — key may target another project.`,
      ),
    );
  }
  console.log(`  Key: ${String(key.client_email ?? 'unknown email')}`);

  mkdirSync(join(ROOT_DIR, '.secrets'), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(key, null, 2), { mode: 0o600 });

  const hasPrivateKey = typeof key.private_key === 'string' && key.private_key.length > 0;
  console.log(
    fmt.ok(
      `Wrote ${outputPath} (${hasPrivateKey ? 'private key present' : '⚠️ NO private key — likely invalid'})`,
    ),
  );
  console.log(
    fmt.note(`Deploy without gcloud login: GOOGLE_APPLICATION_CREDENTIALS=${outputPath}`),
  );
};

await main();
