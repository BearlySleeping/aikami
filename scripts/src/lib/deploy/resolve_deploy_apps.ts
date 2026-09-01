#!/usr/bin/env bun

// scripts/src/lib/deploy/resolve_deploy_apps.ts
//
// Decides which DEPLOYABLE_APPS a CI run should build+deploy. Replaces two
// previously-broken signals in release.yml:
//
//   1. A hand-rolled `case "$file" in apps/frontend/hub/*) …` block that only
//      looked at each app's OWN top-level directory. It never accounted for
//      the project *dependency graph* — a change to e.g.
//      packages/shared/logger (which every app imports) was invisible to it,
//      so a shared-package-only push silently deployed NOTHING even though
//      every app's build output would differ. (hub/moon.yml's `build` task
//      carries a first-hand account of this exact failure mode — a stale
//      cache once shipped /api/logs to prod after logger_browser.ts changed
//      — moon's own build cache was fixed for it; this script closes the
//      same gap one layer up, for the "should we even attempt a deploy"
//      decision.)
//   2. A workflow-level `DEPLOY_APPS: "client-tauri"` fallback that silently
//      kicked in whenever the case statement matched nothing — including a
//      push that only touched `.github/workflows/release.yml` itself, which
//      has nothing to do with the desktop app.
//
// Precedence (highest first):
//   1. `deploy[...]` commit-message override (see commit_parser.ts) — reads
//      the tip commit of the ref being deployed. `deploy[all]`,
//      `deploy[client,site]`, `deploy[all force]`, etc. Works for push AND
//      release events; workflow_dispatch has its own explicit `apps` input
//      instead (higher precedence there — see release.yml).
//   2. push event → moon's own dependency-graph-aware affected-project
//      detection (`moon query projects --affected --downstream=deep`,
//      MOON_BASE/MOON_HEAD set to the push's before/after). This is the
//      SAME mechanism `moon ci` uses for PR checks — not a second
//      hand-rolled implementation of "what depends on what".
//        - client-tauri is deliberately excluded from the affected-app
//          mapping: desktop releases stay a deliberate action (a GitHub
//          Release, or an explicit workflow_dispatch), never an automatic
//          side effect of a web-app push.
//        - Every other DEPLOYABLE_APPS entry (client, site, hub, docs,
//          database) is included when its underlying moon project — or
//          anything it transitively depends on — is affected.
//   3. release event (no commit override) → "client-tauri" (unchanged
//      default — a GitHub Release IS the desktop cut).
//
// Usage:
//   bun scripts/src/lib/deploy/resolve_deploy_apps.ts --event=push --base=<sha> --head=<sha>
//   bun scripts/src/lib/deploy/resolve_deploy_apps.ts --event=release
//
// Output: writes `DEPLOY_APPS=<space-separated app ids, possibly empty>` to
// $GITHUB_ENV (read by resolve_plan.ts, the next step in the same job) and
// `force=<true|false>` to $GITHUB_OUTPUT (a job output other jobs read via
// needs.resolve-plan.outputs.force). Falls back to stdout when not in CI.

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { c, log, ok, parseCliArgs, warn } from '../cli_utils';
import { parseCommitOverride } from './commit_parser';
import { APP_CONFIG, DEPLOYABLE_APPS } from './deployment_config';
import { runArgs } from './utils';

/** Apps a push can never auto-deploy — see the header comment. */
const PUSH_EXCLUDED_APPS = new Set(['client-tauri']);

type MoonAffectedProject = { id: string; source: string };

/** Reads the tip commit message of the currently checked-out ref. */
function readHeadCommitMessage(): string {
  try {
    return execSync('git log -1 --pretty=%B', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Runs moon's own affected-project detection between two revisions,
 * including every downstream dependent (deep) — i.e. "which projects would
 * a build of `head` actually produce different output for, versus `base`".
 */
function queryMoonAffectedProjects(base: string, head: string): MoonAffectedProject[] {
  const output = runArgs(['bun', 'moon', 'query', 'projects', '--affected', '--downstream=deep'], {
    env: { MOON_BASE: base, MOON_HEAD: head },
  });
  // moon prints a `$ moon query …` echo line before the JSON payload.
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) {
    warn(
      'moon query projects --affected produced no JSON output — treating as "nothing affected".',
    );
    return [];
  }
  const parsed = JSON.parse(output.slice(jsonStart)) as { projects: MoonAffectedProject[] };
  return parsed.projects;
}

/** Maps affected moon project ids/sources → DEPLOYABLE_APPS ids. */
function resolveAffectedDeployApps(affected: MoonAffectedProject[]): string[] {
  const affectedIds = new Set(affected.map((p) => p.id));
  const affectedSources = new Set(affected.map((p) => p.source));

  const matched: string[] = [];
  for (const appName of DEPLOYABLE_APPS) {
    if (PUSH_EXCLUDED_APPS.has(appName)) {
      continue;
    }
    const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
    if (!config) {
      continue;
    }
    // The moon project backing this deploy app is usually the app id
    // itself (site, docs, hub) or an explicit override (client-tauri →
    // client, via buildProject) — but for apps like `database`
    // (deploy app id "database", moon project id "backend-database") the
    // ids diverge entirely while the source PATH still matches, so check
    // both.
    const moonProjectId = config.buildProject ?? appName;
    if (affectedIds.has(moonProjectId) || affectedSources.has(config.path)) {
      matched.push(appName);
    }
  }
  return matched;
}

/** `apps` needs to be visible to the next step in THIS job (resolve_plan.ts
 *  reads DEPLOY_APPS from the job env) — $GITHUB_ENV, not $GITHUB_OUTPUT. */
function emitDeployApps(apps: string[]): void {
  const value = apps.join(' ');
  const envPath = process.env.GITHUB_ENV;
  if (!envPath) {
    console.log(`[GITHUB_ENV] DEPLOY_APPS=${value}`);
    return;
  }
  appendFileSync(envPath, `DEPLOY_APPS=${value}\n`);
}

/** `force` needs to be a JOB output (other jobs read
 *  needs.resolve-plan.outputs.force) — $GITHUB_OUTPUT. */
function emitForce(force: boolean): void {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) {
    console.log(`[GITHUB_OUTPUT] force=${force}`);
    return;
  }
  appendFileSync(outPath, `force=${force}\n`);
}

function main(): void {
  const opts = parseCliArgs(process.argv.slice(2), {
    event: { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string' },
  });

  const event = opts.event as string | undefined;
  if (event !== 'push' && event !== 'release') {
    throw new Error(`--event must be "push" or "release" (got ${event ?? '(none)'})`);
  }

  log(`\n${c.bold}📋 Resolving DEPLOY_APPS for event=${event}${c.reset}`);

  const commitMessage = readHeadCommitMessage();
  const override = parseCommitOverride(commitMessage);
  if (override) {
    ok(
      `  Commit-message override: deploy[${override.targets.join(',')}${override.force ? ' force' : ''}]`,
    );
    emitDeployApps(override.targets);
    emitForce(override.force);
    return;
  }

  if (event === 'release') {
    log('  No commit override — release event defaults to client-tauri.');
    emitDeployApps(['client-tauri']);
    emitForce(false);
    return;
  }

  // push, no override → moon-affected detection.
  const base = opts.base as string | undefined;
  const head = opts.head as string | undefined;
  if (!base || !head) {
    throw new Error('--base and --head are required for --event=push');
  }

  // GitHub sets `before` to the all-zeros SHA on a branch's first-ever push
  // (nothing to diff against — the branch didn't exist a moment ago). A
  // `paths:` filter used to hide this case from us entirely by declining to
  // trigger the workflow at all; removing that filter (see release.yml's
  // header comment on why) means this script now has to handle it directly
  // instead of handing `git diff`/moon a commit object that doesn't exist —
  // `moon query projects --affected` would hard-fail with "fatal: bad
  // object" on it. Nothing meaningfully "changed" for a brand-new branch,
  // so the safe, conservative answer is the same one the path filter used
  // to produce: nothing to deploy.
  if (/^0+$/.test(base)) {
    log(
      `  ${c.dim}First push on a new branch (before=${base}) — nothing to diff, nothing to deploy.${c.reset}`,
    );
    emitDeployApps([]);
    emitForce(false);
    return;
  }

  const affectedProjects = queryMoonAffectedProjects(base, head);
  log(`  moon-affected projects: ${affectedProjects.map((p) => p.id).join(', ') || '(none)'}`);

  const apps = resolveAffectedDeployApps(affectedProjects);
  if (apps.length === 0) {
    log(`  ${c.dim}No deployable app is affected by this push — nothing to deploy.${c.reset}`);
  } else {
    ok(`  Affected deployable apps: ${apps.join(', ')}`);
  }
  emitDeployApps(apps);
  emitForce(false);
}

main();
