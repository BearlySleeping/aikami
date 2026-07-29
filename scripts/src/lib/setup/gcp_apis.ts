#!/usr/bin/env bun
// scripts/src/lib/setup/gcp_apis.ts
//
// Enable required GCP APIs for the Aikami project.
//
// Usage:
//   bun run scripts/src/lib/setup/gcp_apis.ts --mode=staging
//   bun run scripts/src/lib/setup/gcp_apis.ts --mode=production --dry-run

import { c, fmt, parseCliArgs, run } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };

const REQUIRED_APIS = [
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'storage.googleapis.com',
  'cloudfunctions.googleapis.com',
  'cloudbuild.googleapis.com',
  'run.googleapis.com',
  'artifactregistry.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'secretmanager.googleapis.com',
  'eventarc.googleapis.com',
  'cloudscheduler.googleapis.com',
  'cloudbilling.googleapis.com',
  'identitytoolkit.googleapis.com',
] as const;

const getEnabledApis = async (projectId: string): Promise<Set<string>> => {
  const { out, code } = await run([
    'gcloud',
    'services',
    'list',
    `--project=${projectId}`,
    '--enabled',
    '--format=value(config.name)',
  ]);
  if (code !== 0) {
    return new Set();
  }
  return new Set(out.split('\n').filter(Boolean));
};

export const setupGcpApis = async (
  projectId: string,
  dryRun: boolean,
): Promise<{ checks: Check[] }> => {
  const checks: Check[] = [];
  console.log(fmt.section('GCP APIs'));

  const enabledApis = await getEnabledApis(projectId);
  const missingApis = REQUIRED_APIS.filter((api) => !enabledApis.has(api));
  const alreadyEnabledApis = REQUIRED_APIS.filter((api) => enabledApis.has(api));

  for (const api of alreadyEnabledApis) {
    console.log(fmt.ok(api));
    checks.push({ name: `API: ${api}`, status: 'ok' });
  }

  if (missingApis.length > 0 && !dryRun) {
    console.log(fmt.fix(`Enabling ${missingApis.length} APIs...`));
    const { code } = await run([
      'gcloud',
      'services',
      'enable',
      ...missingApis,
      `--project=${projectId}`,
      '--quiet',
    ]);
    if (code === 0) {
      for (const api of missingApis) {
        console.log(fmt.ok(`${api} enabled`));
        checks.push({ name: `API: ${api}`, status: 'missing', fixed: true });
      }
    } else {
      for (const api of missingApis) {
        const { code: c2 } = await run([
          'gcloud',
          'services',
          'enable',
          api,
          `--project=${projectId}`,
          '--quiet',
        ]);
        if (c2 === 0) {
          console.log(fmt.ok(`${api} enabled`));
          checks.push({ name: `API: ${api}`, status: 'missing', fixed: true });
        } else {
          console.log(fmt.err(`Failed to enable ${api}`));
          checks.push({ name: `API: ${api}`, status: 'error' });
        }
      }
    }
  } else if (missingApis.length > 0 && dryRun) {
    for (const api of missingApis) {
      console.log(fmt.fix(`Would enable: ${api} (dry-run)`));
      checks.push({ name: `API: ${api}`, status: 'missing', fixed: true });
    }
  }

  if (!dryRun && checks.some((c) => c.fixed)) {
    console.log(fmt.note('Waiting 5s for API propagation...'));
    await new Promise((r) => setTimeout(r, 5000));
  }

  return { checks };
};

if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: {} },
    'dry-run': { type: 'boolean' },
  });
  const mode = (opts.mode as string) ?? 'staging';
  const dryRun = opts['dry-run'] as boolean;
  const projectId = MODE_PROJECT_MAP[mode as keyof typeof MODE_PROJECT_MAP];
  if (!projectId) {
    console.error('Unknown mode');
    process.exit(1);
  }

  console.log(fmt.head(`GCP APIs — ${mode} (${projectId})`));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode.\n'));
  }

  const { checks } = await setupGcpApis(projectId, dryRun);
  const ok = checks.filter((c) => c.status === 'ok').length;
  const fixed = checks.filter((c) => c.fixed).length;
  console.log(fmt.head('Summary'));
  console.log(`  ${c.green}${ok}${c.reset} already enabled, ${c.cyan}${fixed}${c.reset} enabled`);
}
