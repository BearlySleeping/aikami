#!/usr/bin/env bun
// scripts/src/lib/project_setup/artifact_registry.ts
//
// Create the Artifact Registry Docker repository for the aikami-worker VM
// (us-central1 — same region as the VM, so pulls stay within GCP's Always
// Free tier; see apps/backend/worker/README.md and
// scripts/src/lib/worker/deploy.ts). The `aikami` repo this used to default
// to (europe-west1) was for the Firebase/Cloud Run era's image/text/voice
// services, which are all `enabled: false` in deployment_config.ts.
//
// Usage:
//   bun run scripts/src/lib/project_setup/artifact_registry.ts --mode=staging
//   bun run scripts/src/lib/project_setup/artifact_registry.ts --mode=production --dry-run

import { fmt, parseCliArgs, run } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

/**
 * Ensures the worker Docker repository exists in Artifact Registry.
 *
 * @param projectId GCP project that owns the repository.
 * @param region Artifact Registry location.
 * @param dryRun Whether to report required changes without applying them.
 * @param repoName Repository name to check or create.
 * @returns Promise resolving to checks for existing, missing, fixed, or failed configuration.
 */
export const setupArtifactRegistry = async (
  projectId: string,
  region: string,
  dryRun: boolean,
  repoName = 'aikami-worker',
): Promise<{ checks: Check[] }> => {
  const checks: Check[] = [];
  console.log(fmt.section('Artifact Registry'));

  const exists =
    (
      await run([
        'gcloud',
        'artifacts',
        'repositories',
        'describe',
        repoName,
        `--location=${region}`,
        `--project=${projectId}`,
        '--format=json',
        '--quiet',
      ])
    ).code === 0;

  if (exists) {
    console.log(fmt.ok(`Docker repo "${repoName}" in ${region}`));
    checks.push({ name: `Repository: ${repoName}`, status: 'ok' });
  } else {
    console.log(fmt.fix(`Creating Docker repo "${repoName}" in ${region}...`));
    if (!dryRun) {
      const ok =
        (
          await run([
            'gcloud',
            'artifacts',
            'repositories',
            'create',
            repoName,
            '--repository-format=docker',
            `--location=${region}`,
            '--description=Docker repo for Aikami services',
            `--project=${projectId}`,
            '--quiet',
          ])
        ).code === 0;
      if (ok) {
        console.log(fmt.ok(`Repository created`));
        checks.push({ name: `Repository: ${repoName}`, status: 'missing', fixed: true });
      } else {
        checks.push({ name: `Repository: ${repoName}`, status: 'error' });
      }
    } else {
      console.log(fmt.fix(`Would create (dry-run)`));
      checks.push({ name: `Repository: ${repoName}`, status: 'missing', fixed: true });
    }
  }

  return { checks };
};

if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string' },
    region: { type: 'string' },
    'dry-run': { type: 'boolean' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;
  const region = (opts.region as string) ?? 'us-central1';
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error('Unknown mode');
    process.exit(1);
  }

  console.log(fmt.head(`Artifact Registry — ${mode} (${projectId})`));
  await setupArtifactRegistry(projectId, region, dryRun);
}
