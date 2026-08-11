#!/usr/bin/env bun
// scripts/src/lib/project_setup/cdn_hosting_setup.ts
//
// Create Firebase Hosting CDN sites for Tauri release downloads.
// Sets up fixed URLs like cdn.bearlysleeping.com/aikami/stable/linux
// that redirect to GCS channel artifacts.
//
// Usage:
//   bun run scripts/src/lib/project_setup/cdn_hosting_setup.ts --mode=staging
//   bun run scripts/src/lib/project_setup/cdn_hosting_setup.ts --mode=production --dry-run

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmt, parseCliArgs, runStream } from '../cli_utils';
import { MODE_PROJECT_MAP } from '../deploy/deployment_config';

type Check = { name: string; status: 'ok' | 'missing' | 'error'; detail?: string; fixed?: boolean };
type ManualStep = { title: string; url?: string; commands?: string[]; detail?: string };

// ── Constants ─────────────────────────────────────────────────────────────

/** Canonical extension per platform — matches pickCanonical() in tauri_release.ts. */
const PLATFORM_EXTENSIONS: Record<string, string> = {
  linux: '.deb',
  macos: '.dmg',
  windows: '.msi',
};

const CDN_PUBLIC_DIR = join(tmpdir(), 'aikami-cdn-public');

/** Hosting site names per mode. */
const CDN_SITE_SUFFIX = 'cdn';

/**
 * Builds the GCS storage.googleapis.com URL for a channel artifact.
 * Uses the direct storage URL (not gs://) so it's browser-accessible.
 */
const buildStorageUrl = (
  projectId: string,
  appName: string,
  channel: string,
  platform: string,
): string => {
  const ext = PLATFORM_EXTENSIONS[platform];
  return `https://storage.googleapis.com/${projectId}.firebasestorage.app/tauri-releases/${appName}/channel/${channel}/${platform}${ext}`;
};

/**
 * Generates the firebase.json with redirects for the CDN hosting site.
 * Each channel (stable, beta) gets redirects for all three platforms.
 */
const generateCdnFirebaseConfig = (): Record<string, unknown> => {
  const stagingId = MODE_PROJECT_MAP.staging;
  const productionId = MODE_PROJECT_MAP.production;
  const appName = 'client-tauri';

  const redirects = [
    // ── Stable channel (production) ──
    {
      source: '/aikami/stable/linux',
      destination: buildStorageUrl(productionId, appName, 'stable', 'linux'),
      type: 302,
    },
    {
      source: '/aikami/stable/macos',
      destination: buildStorageUrl(productionId, appName, 'stable', 'macos'),
      type: 302,
    },
    {
      source: '/aikami/stable/windows',
      destination: buildStorageUrl(productionId, appName, 'stable', 'windows'),
      type: 302,
    },
    // ── Beta channel (staging) ──
    {
      source: '/aikami/beta/linux',
      destination: buildStorageUrl(stagingId, appName, 'beta', 'linux'),
      type: 302,
    },
    {
      source: '/aikami/beta/macos',
      destination: buildStorageUrl(stagingId, appName, 'beta', 'macos'),
      type: 302,
    },
    {
      source: '/aikami/beta/windows',
      destination: buildStorageUrl(stagingId, appName, 'beta', 'windows'),
      type: 302,
    },
  ];

  return {
    hosting: {
      target: 'cdn',
      public: '.',
      redirects,
    },
  };
};

// ── Setup ─────────────────────────────────────────────────────────────────

export const setupCdnHosting = async (
  dryRun: boolean,
): Promise<{ checks: Check[]; manualSteps: ManualStep[] }> => {
  const checks: Check[] = [];
  const manualSteps: ManualStep[] = [];

  console.log(fmt.section('CDN Hosting Sites'));

  // ── 1. Create CDN hosting sites for staging and production ───────────
  for (const mode of ['staging', 'production'] as const) {
    const projectId = MODE_PROJECT_MAP[mode];
    const siteId = `${projectId}-${CDN_SITE_SUFFIX}`;

    console.log(fmt.note(`Checking CDN site for ${mode}: ${siteId}`));

    try {
      // Check if site exists by trying to get it
      const getCode = await runStream(
        [
          'npx',
          '-y',
          'firebase-tools@latest',
          'hosting:sites:get',
          siteId,
          `--project=${projectId}`,
        ],
        {},
      );
      if (getCode === 0) {
        console.log(fmt.ok(`CDN site "${siteId}" (${mode})`));
        checks.push({ name: `CDN site: ${siteId}`, status: 'ok' });
      } else {
        console.log(fmt.fix(`Creating CDN site "${siteId}" (${mode})...`));
        if (!dryRun) {
          const createCode = await runStream(
            [
              'npx',
              '-y',
              'firebase-tools@latest',
              'hosting:sites:create',
              siteId,
              `--project=${projectId}`,
            ],
            {},
          );
          if (createCode === 0) {
            console.log(fmt.ok(`CDN site "${siteId}" created`));
            checks.push({ name: `CDN site: ${siteId}`, status: 'missing', fixed: true });
          } else {
            console.log(fmt.err(`Failed to create CDN site "${siteId}"`));
            checks.push({ name: `CDN site: ${siteId}`, status: 'error' });
          }
        } else {
          console.log(fmt.fix(`Would create CDN site "${siteId}" (dry-run)`));
          checks.push({ name: `CDN site: ${siteId}`, status: 'missing', fixed: true });
        }
      }
    } catch (err) {
      console.log(fmt.err(`Error checking CDN site ${siteId}: ${(err as Error).message}`));
      checks.push({ name: `CDN site: ${siteId}`, status: 'error' });
    }
  }

  // ── 2. Generate firebase.json with redirects ─────────────────────────
  console.log(fmt.section('CDN firebase.json'));
  const cdnDir = CDN_PUBLIC_DIR;
  if (!existsSync(cdnDir)) {
    if (!dryRun) {
      mkdirSync(cdnDir, { recursive: true });
      console.log(fmt.ok(`Created ${CDN_PUBLIC_DIR}/`));
    } else {
      console.log(fmt.fix(`Would create ${CDN_PUBLIC_DIR}/ (dry-run)`));
    }
  } else {
    console.log(fmt.ok(`${CDN_PUBLIC_DIR}/ exists`));
  }

  const config = generateCdnFirebaseConfig();
  const configPath = join(CDN_PUBLIC_DIR, 'firebase.json');
  if (!dryRun) {
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(fmt.ok(`Generated ${CDN_PUBLIC_DIR}/firebase.json`));
    checks.push({ name: 'CDN firebase.json', status: 'missing', fixed: true });
  } else {
    console.log(fmt.fix(`Would generate ${CDN_PUBLIC_DIR}/firebase.json (dry-run)`));
    checks.push({ name: 'CDN firebase.json', status: 'missing', fixed: true });
  }

  // ── 3. Apply hosting target to firebase.json ─────────────────────────
  //    This maps the "cdn" target to the site we just created.
  console.log(fmt.section('Firebase Target'));
  const stagingSiteId = `${MODE_PROJECT_MAP.staging}-${CDN_SITE_SUFFIX}`;
  const productionSiteId = `${MODE_PROJECT_MAP.production}-${CDN_SITE_SUFFIX}`;

  manualSteps.push({
    title: 'Apply CDN hosting targets',
    commands: [
      `firebase target:apply hosting cdn ${stagingSiteId} --project=${MODE_PROJECT_MAP.staging}`,
      `firebase target:apply hosting cdn ${productionSiteId} --project=${MODE_PROJECT_MAP.production}`,
    ],
    detail: 'These map the "cdn" target to each project\'s CDN hosting site.',
  });

  // ── 4. Custom domain setup ───────────────────────────────────────────
  manualSteps.push({
    title: 'Add custom domains in Firebase Console',
    url: `https://console.firebase.google.com/project/${MODE_PROJECT_MAP.production}/hosting/sites`,
    commands: [],
    detail:
      `Production: cdn.bearlysleeping.com → ${productionSiteId}\n` +
      `Staging:    cdn.stg.bearlysleeping.com → ${stagingSiteId}\n\n` +
      'Firebase Console will prompt you to add TXT records for verification —\n' +
      'then auto-provisions free SSL certificates.',
  });

  // ── 5. Deploy instructions ───────────────────────────────────────────
  console.log(fmt.section('Deploy'));
  console.log(fmt.note('After setup, deploy the CDN config:'));
  console.log(
    fmt.cmd(
      `cd ${CDN_PUBLIC_DIR} && firebase deploy --only hosting:cdn --project=${MODE_PROJECT_MAP.staging}`,
    ),
  );
  console.log(
    fmt.cmd(
      `cd ${CDN_PUBLIC_DIR} && firebase deploy --only hosting:cdn --project=${MODE_PROJECT_MAP.production}`,
    ),
  );

  // ── 6. GCS public access ─────────────────────────────────────────────
  manualSteps.push({
    title: 'Make channel artifacts publicly readable in GCS',
    commands: [
      `gcloud storage objects update "gs://${MODE_PROJECT_MAP.production}.firebasestorage.app/tauri-releases/**" --add-acl-grant=entity=allUsers,role=READER`,
      `gcloud storage objects update "gs://${MODE_PROJECT_MAP.staging}.firebasestorage.app/tauri-releases/**" --add-acl-grant=entity=allUsers,role=READER`,
    ],
    detail:
      'Required so Firebase Hosting redirects can serve the channel artifacts.\n' +
      'Run after at least one Tauri deploy has populated the channel paths.',
  });

  return { checks, manualSteps };
};

// ── CLI ───────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    'dry-run': { type: 'boolean' },
  });
  const dryRun = opts['dry-run'] as boolean;

  console.log(fmt.head('CDN Hosting Setup'));
  if (dryRun) {
    console.log(fmt.warn('Dry-run mode.\n'));
  }

  await setupCdnHosting(dryRun);
}
