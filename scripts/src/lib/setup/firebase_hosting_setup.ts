#!/usr/bin/env bun
// scripts/src/lib/setup/firebase_hosting_setup.ts
//
// Create Firebase Hosting sites for all firebase-hosting apps.
//
// Usage:
//   bun run scripts/src/lib/setup/firebase_hosting_setup.ts --mode=staging
//   bun run scripts/src/lib/setup/firebase_hosting_setup.ts --mode=production --dry-run

import { fmt, parseCliArgs, run } from '../cli_utils';
import { APP_CONFIG, MODE_PROJECT_MAP, resolveHostingSiteId } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

const checkHostingSite = async (projectId: string, siteId: string): Promise<boolean> => {
  const { code } = await run([
    'npx',
    '-y',
    'firebase-tools@latest',
    'hosting:sites:get',
    siteId,
    `--project=${projectId}`,
  ]);
  return code === 0;
};

const createHostingSite = async (projectId: string, siteId: string): Promise<boolean> => {
  const { code } = await run([
    'npx',
    '-y',
    'firebase-tools@latest',
    'hosting:sites:create',
    siteId,
    `--project=${projectId}`,
  ]);
  return code === 0;
};

export const setupFirebaseHosting = async (
  projectId: string,
  dryRun: boolean,
): Promise<{ checks: Check[]; manualSteps: ManualStep[] }> => {
  const checks: Check[] = [];
  const manualSteps: ManualStep[] = [];

  console.log(fmt.section('Firebase Hosting Sites'));

  for (const [appName, appConfig] of Object.entries(APP_CONFIG)) {
    // firebase-hosting apps deploy directly to Hosting; cloud-run-sveltekit
    // apps (e.g. hub) are fronted by a per-mode Hosting site that rewrites
    // to their Cloud Run service — both need the site to exist.
    if (
      appConfig.serviceType !== 'firebase-hosting' &&
      appConfig.serviceType !== 'cloud-run-sveltekit'
    ) {
      continue;
    }

    const siteId = resolveHostingSiteId(appName as never, projectId);
    if (!siteId) {
      console.log(fmt.note(`Skipping ${appName} — no site ID`));
      continue;
    }

    const exists = await checkHostingSite(projectId, siteId);
    if (exists) {
      console.log(fmt.ok(`Site "${siteId}" (${appName})`));
      checks.push({ name: `Site: ${siteId}`, status: 'ok' });
    } else {
      console.log(fmt.fix(`Creating site "${siteId}" (${appName})...`));
      if (!dryRun) {
        const ok = await createHostingSite(projectId, siteId);
        if (ok) {
          console.log(fmt.ok(`Site created`));
          checks.push({ name: `Site: ${siteId}`, status: 'missing', fixed: true });
        } else {
          console.log(fmt.err(`Failed to create "${siteId}"`));
          checks.push({ name: `Site: ${siteId}`, status: 'error' });
        }
      } else {
        console.log(fmt.fix(`Would create "${siteId}" (dry-run)`));
        checks.push({ name: `Site: ${siteId}`, status: 'missing', fixed: true });
      }
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

  console.log(fmt.head(`Firebase Hosting Setup — ${mode} (${projectId})`));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode.\n'));
  }

  await setupFirebaseHosting(projectId, dryRun);
}
