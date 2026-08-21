#!/usr/bin/env bun
// scripts/src/lib/deploy/resolve_plan.ts
//
// CI-only planner that turns DEPLOY_APPS into per-service-type app lists.
// This is what lets release.yml:
//
//   1. Fetch every app's secrets EXACTLY ONCE (see the prepare-secrets job),
//      instead of once per service type / once per app.
//   2. Run one job PER SERVICE TYPE (desktop, cloudflare-worker,
//      firebase-functions, docker-release), each gated at
//      the JOB level (`if: needs.resolve-plan.outputs.xxx != ''`) instead of
//      step-level `if` chains inside one monolithic job.
//
// Grouping is driven entirely by APP_CONFIG[app].serviceType — the same
// source of truth index.ts already switches on — so adding a new deployable
// app to deployment_config.ts never requires touching this script or
// release.yml; it just needs a serviceType this script already recognizes.
//
// Usage: bun scripts/src/lib/deploy/resolve_plan.ts
// env:   DEPLOY_APPS  "client-tauri" | "all" | space-separated app names
//                      (matches the DEPLOY_APPS workflow-level env var)

import { writeFileSync } from 'node:fs';
import { c, log, ok, warn } from '../cli_utils';
import { APP_CONFIG, DEPLOYABLE_APPS, type ServiceType } from './deployment_config';

/**
 * serviceType → the $GITHUB_OUTPUT key the matching job reads.
 * Typed as `Record<ServiceType, string>` (not `Record<string, string>`) on
 * purpose: if a 6th entry is ever added to ALL_SERVICE_TYPES in
 * deployment_config.ts without a matching release.yml job, this file simply
 * fails to compile instead of silently dropping those apps from every plan.
 */
const SERVICE_TYPE_OUTPUT_KEY: Record<ServiceType, string> = {
  'tauri-release': 'desktop_apps',
  'cloudflare-worker': 'cloudflare_apps',
  'firebase-functions': 'firebase_functions_apps',
  'docker-release': 'docker_release_apps',
  'database-migration': 'database_migration_apps',
};

/** Write a single-line value to $GITHUB_OUTPUT (or console when not in CI). */
function emitOutput(key: string, value: string): void {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) {
    console.log(`[GITHUB_OUTPUT] ${key}=${value}`);
    return;
  }
  writeFileSync(outPath, `${key}=${value}\n`, { flag: 'a' });
}

function main(): void {
  const raw = (process.env.DEPLOY_APPS ?? '').trim();
  const deployableSet = new Set(DEPLOYABLE_APPS);

  let apps: string[];
  if (raw === 'all' || raw === '') {
    apps = [...DEPLOYABLE_APPS];
  } else {
    const requested = raw.split(/\s+/).filter(Boolean);
    const unknown = requested.filter((a) => !deployableSet.has(a));
    if (unknown.length > 0) {
      log(`\n${c.bold}❌ Invalid DEPLOY_APPS${c.reset}`);
      log(`  Unknown app(s): ${unknown.join(', ')}`);
      log(`  Valid apps: ${DEPLOYABLE_APPS.join(', ')}`);
      process.exit(1);
    }
    // De-duplicate while preserving requested order
    const seen = new Set<string>();
    apps = requested.filter((a) => {
      if (deployableSet.has(a) && !seen.has(a)) {
        seen.add(a);
        return true;
      }
      return false;
    });
  }

  log(`\n${c.bold}📋 Resolving deploy plan${c.reset}`);
  log(`  DEPLOY_APPS: ${raw || '(empty → all)'}`);
  log(`  Resolved:    ${apps.join(', ') || '(none)'}`);

  const buckets: Record<string, string[]> = {
    desktop_apps: [],
    cloudflare_apps: [],
    firebase_functions_apps: [],
    docker_release_apps: [],
    database_migration_apps: [],
  };

  for (const app of apps) {
    const config = APP_CONFIG[app as keyof typeof APP_CONFIG];
    if (!config) {
      warn(`  ${app}: no APP_CONFIG entry — skipping.`);
      continue;
    }
    const key = SERVICE_TYPE_OUTPUT_KEY[config.serviceType];
    if (!key) {
      warn(`  ${app}: unrecognized serviceType "${config.serviceType}" — no job handles this yet.`);
      continue;
    }
    buckets[key].push(app);
  }

  // The union — one Secret Manager fetch for the whole run, however many
  // service types are actually in play (see prepare-secrets in release.yml).
  emitOutput('all_apps', apps.join(' '));
  for (const [key, list] of Object.entries(buckets)) {
    emitOutput(key, list.join(' '));
  }

  ok('\nPlan resolved:');
  let anything = false;
  for (const [key, list] of Object.entries(buckets)) {
    if (list.length > 0) {
      ok(`  ${key}: ${list.join(', ')}`);
      anything = true;
    }
  }
  if (!anything) {
    warn('  Nothing to deploy — every downstream job will be skipped.');
  }
}

main();
