#!/usr/bin/env bun
// scripts/src/lib/project_setup/firebase_hosting_setup.ts
//
// Create Firebase Hosting sites for all firebase-hosting apps.
//
// Usage:
//   bun run scripts/src/lib/project_setup/firebase_hosting_setup.ts --mode=staging
//   bun run scripts/src/lib/project_setup/firebase_hosting_setup.ts --mode=production --dry-run

import { fmt, parseCliArgs, run } from '../cli_utils';
import {
  APP_CONFIG,
  MODE_PROJECT_MAP,
  resolveHostingSiteId,
  resolveModeFromProjectId,
} from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

const checkHostingSite = async (projectId: string, siteId: string): Promise<boolean> => {
  const { code } = await run([
    'bunx',
    'firebase-tools@15.26.0',
    'hosting:sites:get',
    siteId,
    `--project=${projectId}`,
  ]);
  return code === 0;
};

const createHostingSite = async (projectId: string, siteId: string): Promise<boolean> => {
  const { code } = await run([
    'bunx',
    'firebase-tools@15.26.0',
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
  const liveMode = resolveModeFromProjectId(projectId);
  /** siteId â†’ custom domain, collected for the manual domain-linking step. */
  const domainMappings: string[] = [];

  console.log(fmt.section('Firebase Hosting Sites'));

  for (const [appName, appConfig] of Object.entries(APP_CONFIG)) {
    // firebase-hosting apps deploy directly to Hosting; cloud-run-sveltekit
    // apps (e.g. hub) are fronted by a per-mode Hosting site that rewrites
    // to their Cloud Run service â€” both need the site to exist.
    if (
      appConfig.serviceType !== 'firebase-hosting' &&
      appConfig.serviceType !== 'cloud-run-sveltekit'
    ) {
      continue;
    }

    const siteId = resolveHostingSiteId(appName as never, projectId);
    if (!siteId) {
      console.log(fmt.note(`Skipping ${appName} â€” no site ID`));
      continue;
    }

    const customDomain = liveMode ? appConfig.customDomains?.[liveMode] : undefined;
    if (customDomain) {
      domainMappings.push(`${customDomain.padEnd(32)} â†’ ${siteId}`);
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

  // Custom domains can't be provisioned from the CLI â€” Firebase requires DNS
  // verification records added through the console â€” so surface them as an
  // explicit manual step instead of silently leaving sites on *.web.app.
  if (domainMappings.length > 0) {
    manualSteps.push({
      title: `Link custom domains (${liveMode})`,
      url: `https://console.firebase.google.com/project/${projectId}/hosting/sites`,
      detail:
        `${domainMappings.join('\n')}\n\n` +
        'Open each site â†’ "Add custom domain", then add the TXT/A records\n' +
        'Firebase prompts for. SSL certificates are provisioned automatically\n' +
        'once verification passes. Until then each site stays on its default\n' +
        '*.web.app or *.firebaseapp.com URL (derived from the site ID), which\n' +
        'is still fully deployable.',
    });
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

  console.log(fmt.head(`Firebase Hosting Setup â€” ${mode} (${projectId})`));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode.\n'));
  }

  const { manualSteps } = await setupFirebaseHosting(projectId, dryRun);

  // Mirror project_setup/index.ts's rendering so running this script directly
  // still surfaces the steps that can't be automated.
  if (manualSteps.length > 0) {
    console.log(fmt.head(`â•â•â• Manual Steps (${manualSteps.length}) â•â•â•`));
    for (const [index, step] of manualSteps.entries()) {
      console.log(fmt.step(index + 1, step.title));
      if (step.url) {
        console.log(fmt.url(step.url));
      }
      for (const command of step.commands ?? []) {
        console.log(fmt.cmd(command));
      }
      if (step.detail) {
        console.log(fmt.note(step.detail));
      }
      console.log();
    }
  }
}
