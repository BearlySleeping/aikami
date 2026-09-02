#!/usr/bin/env bun
// scripts/src/lib/project_setup/index.ts
/**
 * Aikami Project Setup Wizard
 *
 * One-time GCP project setup for the aikami-worker Compute Engine VM —
 * orchestrates GCP APIs, Artifact Registry, IAM, and Secret Manager. See
 * apps/backend/worker/README.md for what this VM is and why it's the only
 * thing left on GCP (everything else moved to Cloudflare Workers/D1/R2).
 *
 * 🔴 This is PROJECT (cloud infrastructure) setup, NOT local machine setup.
 * For local developer environment setup, run: bun run setup
 *
 * Usage:
 *   bun run project:setup                    # Full interactive setup
 *   bun run project:setup --mode=production  # Target specific mode (worker is production-only)
 *   bun run project:setup --mode=production --dry-run   # Check only, no changes
 *
 * Individual steps:
 *   bun run scripts/src/lib/project_setup/gcp_apis.ts --mode=production
 *   bun run scripts/src/lib/project_setup/artifact_registry.ts --mode=production
 *   bun run scripts/src/lib/project_setup/secrets_manager.ts --mode=production
 */

import { c, fmt, parseCliArgs } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';
import { setupArtifactRegistry } from './artifact_registry';
import { setupGcpApis } from './gcp_apis';
import { setupIam } from './iam';
import { setupSecrets } from './secrets_manager';

const WORKER_REGION = 'us-central1';

// ─── Types ────────────────────────────────────────────────────────────────
type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

// ─── CLI ──────────────────────────────────────────────────────────────────
const opts = parseCliArgs(Bun.argv.slice(2), {
  mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
  'dry-run': { type: 'boolean' },
});
const DRY_RUN = opts['dry-run'] as boolean;

// ─── Helpers ──────────────────────────────────────────────────────────────
/** Run a command array without a shell, returning trimmed stdout + exit code. */
async function runCmd(cmd: string[]): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn({ cmd, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { out: out.trim(), code };
}

/** Return the ACTIVE gcloud account email, or null if not authenticated. */
async function checkGcloudAuth(): Promise<string | null> {
  const { out, code } = await runCmd([
    'gcloud',
    'auth',
    'list',
    '--filter=status:ACTIVE',
    '--format=json',
  ]);
  if (code !== 0) {
    return null;
  }
  try {
    const accounts = JSON.parse(out) as Array<{ account: string }>;
    return accounts[0]?.account ?? null;
  } catch {
    return null;
  }
}

/** Whether the given GCP project exists and is describable. */
async function checkProject(projectId: string): Promise<boolean> {
  const { code } = await runCmd(['gcloud', 'projects', 'describe', projectId, '--quiet']);
  return code === 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────
/**
 * Interactive project setup wizard: runs each setup step (APIs, Artifact
 * Registry, IAM, Secret Manager) in sequence, honoring dry-run.
 */
async function main() {
  console.log(fmt.head('Aikami Project Setup'));

  if (DRY_RUN) {
    console.log(fmt.warn('Dry-run mode — no changes will be made.\n'));
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  console.log(fmt.section('Checking gcloud auth'));
  const account = await checkGcloudAuth();
  if (!account) {
    console.log(fmt.err('Not logged in to gcloud. Run: gcloud auth login'));
    process.exit(1);
  }
  console.log(fmt.ok(`Logged in as ${c.bold}${account}${c.reset}`));

  // ── Mode & Project ───────────────────────────────────────────────────
  console.log(fmt.section('Mode & Project'));
  const mode = (opts.mode as string) ?? 'staging';
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.log(
      fmt.err(`Unknown mode "${mode}". Valid: ${Object.keys(MODE_PROJECT_MAP).join(', ')}`),
    );
    process.exit(1);
  }

  console.log(
    `  Mode: ${c.bold}${mode}${c.reset}   Project: ${c.bold}${projectId}${c.reset}   Region: ${c.bold}${WORKER_REGION}${c.reset}`,
  );

  const projOk = await checkProject(projectId);
  if (!projOk) {
    console.log(fmt.err(`Project ${projectId} not found.`));
    console.log(fmt.note('Create it at: https://console.cloud.google.com/projectcreate'));
    process.exit(1);
  }
  console.log(fmt.ok(`Project ${projectId} exists`));

  const allChecks: Check[] = [];
  const allManualSteps: ManualStep[] = [];

  // ── GCP APIs ─────────────────────────────────────────────────────
  {
    const { checks } = await setupGcpApis(projectId, DRY_RUN);
    allChecks.push(...checks);
  }

  // ── Artifact Registry ─────────────────────────────────────────────
  {
    const { checks } = await setupArtifactRegistry(projectId, WORKER_REGION, DRY_RUN);
    allChecks.push(...checks);
  }

  // ── IAM (deploy + runtime service account roles) ───────────────────
  {
    const deploySaEmail = `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`;
    const runtimeSaEmail = `worker@${projectId}.iam.gserviceaccount.com`;
    const { checks } = await setupIam(projectId, deploySaEmail, DRY_RUN, runtimeSaEmail);
    allChecks.push(...checks);
  }

  // ── Secret Manager ────────────────────────────────────────────────
  {
    const { checks, manualSteps } = await setupSecrets(projectId, DRY_RUN);
    allChecks.push(...checks);
    allManualSteps.push(...manualSteps);
  }

  // ── Billing check ────────────────────────────────────────────────────
  console.log(fmt.section('Billing'));
  const { out: billingOut } = await runCmd([
    'gcloud',
    'billing',
    'projects',
    'describe',
    projectId,
    '--format=json',
    '--quiet',
  ]);
  let billingEnabled = false;
  try {
    billingEnabled =
      (JSON.parse(billingOut) as { billingEnabled?: boolean }).billingEnabled === true;
  } catch {
    /* */
  }

  if (billingEnabled) {
    console.log(fmt.ok('Billing is enabled'));
    allChecks.push({ name: 'Billing', status: 'ok' });
  } else {
    console.log(fmt.warn('Billing is NOT enabled'));
    allChecks.push({ name: 'Billing', status: 'missing' });
    allManualSteps.push({
      title: 'Enable billing on the project',
      url: `https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
      detail: 'Required for: Compute Engine, Artifact Registry, Secret Manager',
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const okCount = allChecks.filter((check) => check.status === 'ok').length;
  const fixed = allChecks.filter((check) => check.fixed).length;
  const errors = allChecks.filter((check) => check.status === 'error').length;

  console.log(fmt.head('═══ Summary ═══'));
  console.log(`  ${c.green}${okCount}${c.reset} already configured`);
  console.log(`  ${c.cyan}${fixed}${c.reset} fixed automatically`);
  if (errors > 0) {
    console.log(`  ${c.red}${errors}${c.reset} errors`);
  }

  if (allManualSteps.length > 0) {
    console.log(fmt.head(`═══ Manual Steps (${allManualSteps.length}) ═══`));
    for (let i = 0; i < allManualSteps.length; i++) {
      const step = allManualSteps[i];
      console.log(fmt.step(i + 1, `${c.bold}${step.title}${c.reset}`));
      if (step.url) {
        console.log(fmt.url(step.url));
      }
      if (step.commands) {
        for (const cmd of step.commands) {
          console.log(fmt.cmd(cmd));
        }
      }
      if (step.detail) {
        console.log(fmt.note(step.detail));
      }
      console.log();
    }
  }

  if (errors > 0) {
    console.log(fmt.err('Some steps failed. Fix and retry.\n'));
    process.exit(1);
  }

  console.log(`${c.green}${c.bold}Done!${c.reset} Complete the manual steps above.\n`);
}

try {
  await main();
} catch (err) {
  console.error(fmt.err(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
