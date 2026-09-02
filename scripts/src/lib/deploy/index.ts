// scripts/src/lib/deploy/index.ts
/**
 * Local deploy script — mirrors the CI deploy pipeline but runs locally.
 *
 * Usage:
 *   bun run deploy                               # Deploy only affected apps
 *   bun run deploy client                        # Deploy single app (with checksum skip)
 *   bun run deploy client site                   # Deploy multiple apps
 *   bun run deploy all                           # Deploy all (skips unchanged via checksum)
 *   bun run deploy --force                       # Deploy all, bypass checksums + force moon rebuild
 *   bun run deploy all --force                   # Deploy all, bypass checksums
 *   bun run deploy --yes                         # Deploy affected without prompts
 *   bun run deploy --production                  # Deploy to production
 *   bun run deploy --mode=staging                # Deploy to staging
 *   bun run deploy client --notify               # Send Telegram notification after
 *   bun run deploy --quiet                       # Suppress non-essential output
 *
 * Checksum caching:
 *   All deployable apps use a content-based checksum (git tree + config + .env).
 *   Upstash Redis is the authoritative online cache — checked first and always
 *   trusted. Local .deploy-cache.json is a fallback only used when Redis is
 *   unreachable. Deploy is skipped when the checksum matches — use --force to bypass.
 *
 * What it does for each app type:
 *   Cloud Run SvelteKit (client)     → checksum → build → prepare package → docker → push → deploy
 *   Tauri Release (client-tauri)      → checksum → build web → cargo tauri build → upload to GCS
 *   Firebase Hosting (site, docs)    → checksum → build (moon) → deploy via moon
 *   Docker Release (image,text,voice)→ checksum → docker build → push
 *
 * CI-only flags (no effect on local runs, and not shown in the usage block
 * above on purpose — they exist purely so release.yml can share a single
 * SvelteKit build between the desktop matrix and the Cloud Run deploy):
 *   --version=<string>          Use this exact version instead of calling
 *                                generateVersionString(). Required whenever
 *                                --skip-build-for is used, so the reused
 *                                build's embedded version matches what the
 *                                shared build job actually produced.
 *   --skip-build-for=<targets>  Comma-separated moon build targets (e.g.
 *                                "client") to skip in Phase 1 because their
 *                                dist is already sitting on disk — the
 *                                caller downloaded it from a shared build
 *                                artifact before invoking this script.
 */

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from '../../../../apps/backend/cloudflare/src/lib/db/migrate.ts';
import { reconcileBucket } from '../../../../apps/backend/cloudflare/src/lib/storage/sync.ts';
import { c, error, log, ok, parseCliArgs, setLogQuiet, warn } from '../cli_utils';
import { getScriptsEnv, initScriptsEnv } from '../env/scripts_env';
import { checkDeployCache, generateVersionString } from './cache';
import { deployCloudflareWorker } from './cloudflare';
import {
  APP_CONFIG,
  type AppConfig,
  DEPLOYABLE_APPS,
  liveModes,
  MODE_PROJECT_MAP,
} from './deployment_config';
import { deployDockerRelease } from './docker_release';
import { type AppResult, type NotificationInput, notifyDeployment } from './notification';
import { deployTauriRelease } from './tauri_release';
import {
  getCurrentBranch,
  isVerbose,
  resolveProjectId,
  run,
  setQuiet,
  setVerbose,
  shortSha,
} from './utils';

// ── Root directory ───────────────────────────────────────────────────────

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

// ── Affected detection ───────────────────────────────────────────────────

/**
 * Runs `moon query projects --affected` and returns the list of affected project IDs.
 * Returns empty array if the command fails or produces no output.
 */
function getAffectedProjects(): string[] {
  try {
    const raw = execSync('bun moon query projects --affected', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    const parsed = JSON.parse(raw);
    return (parsed.projects ?? []).map((p: { id: string }) => p.id);
  } catch {
    warn('Failed to detect affected projects. Falling back to all.');
    return [];
  }
}

/** Whether running in a CI environment (Cloud Build or GitHub Actions). */
const isCI = !!process.env.BUILD_ID || !!process.env.CI;

// ── Helpers ──────────────────────────────────────────────────────────────

let _autoYes = false;

/**
 * Prompt for a yes/no confirmation, honoring --yes (auto-yes) and
 * defaulting to no on non-TTY input.
 */
async function confirm(msg: string): Promise<boolean> {
  if (_autoYes) {
    log(`${c.dim}(auto-yes)${c.reset} ${msg}`);
    return true;
  }
  if (!processStdin.isTTY) {
    log(`${c.dim}(non-TTY, defaulting to no)${c.reset}`);
    return false;
  }
  const rl = createInterface({ input: processStdin, output: processStdout });
  const answer = await rl.question(`\n${c.yellow}?${c.reset} ${msg} ${c.dim}(y/N)${c.reset} `);
  rl.close();
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

// ── Deploy Orchestrator ──────────────────────────────────────────────────

/**
 * Deploy one app end-to-end for the given mode: checksum cache check,
 * build, package, push and deploy per its service type.
 */
async function deployApp(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<'success' | 'failure'> {
  switch (config.serviceType) {
    case 'cloudflare-worker':
      await deployCloudflareWorker(
        config,
        appName,
        mode,
        rootDir,
        version,
        isForce,
        preflightChecksum,
        true, // orchestrator already built in Phase 1
      );
      return 'success';
    case 'tauri-release':
      await deployTauriRelease(config, appName, mode, rootDir, version, isForce, preflightChecksum);
      return 'success';
    case 'docker-release':
      await deployDockerRelease(
        config,
        appName,
        mode,
        rootDir,
        version,
        isForce,
        preflightChecksum,
      );
      return 'success';
    case 'infra':
      // Infra apps (database, storage) never need a moon build, docker
      // push or Cloud Run deploy — just an explicit, idempotent operation.
      switch (config.target) {
        case 'd1-migrate':
          await applyMigrations({ mode, isLocal: mode === 'emulator' });
          return 'success';
        case 'r2-reconcile':
          await reconcileBucket({ mode, isLocal: mode === 'emulator', bucketKey: 'saves' });
          return 'success';
        default:
          throw new Error(`Unsupported infra target for ${appName}`);
      }
    default:
      warn(`Unknown service type "${(config as AppConfig).serviceType}" for ${appName}. Skipping.`);
      return 'success';
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

/**
 * Deploy CLI entry: parse args, detect affected apps, authenticate, then
 * run the deploy phases (build, push, deploy) for the requested apps.
 */
async function main(): Promise<void> {
  const rawArgs = Bun.argv.slice(2);
  // args[0] is 'deploy' if called via the scripts runner, or the first app name
  const args = rawArgs[0] === 'deploy' ? rawArgs.slice(1) : rawArgs;

  // Parse all flags in one pass
  const opts = parseCliArgs(args, {
    verbose: { type: 'boolean' },
    quiet: { type: 'boolean', aliases: ['q'] },
    notify: { type: 'boolean' },
    production: { type: 'boolean' },
    force: { type: 'boolean', aliases: ['f'] },
    yes: { type: 'boolean', aliases: ['y'] },
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    // CI-only — see the header comment above.
    version: { type: 'string' },
    'skip-build-for': { type: 'string' },
  });

  if (opts.verbose) {
    setVerbose(true);
  }

  if (opts.quiet) {
    setQuiet(true);
    setLogQuiet(true);
    _autoYes = true; // quiet implies yes — no prompts
  }

  const shouldNotify = opts.notify;
  const isProduction = opts.production;
  const isForce = opts.force;
  if (opts.yes) {
    _autoYes = true;
  }

  // Positional args = app names to deploy
  const remainingArgs = opts._;

  const branch = getCurrentBranch();

  // Resolve mode. --mode=<mode> > --production > default staging.
  let mode: string;
  const modeFromFlag = opts.mode as string | undefined;
  if (modeFromFlag) {
    mode = modeFromFlag;
  } else if (isProduction) {
    mode = 'production';
  } else {
    mode = liveModes[0]; // staging
  }

  // Validate the mode exists
  if (!(mode in MODE_PROJECT_MAP)) {
    error(`Unknown mode "${mode}". Valid modes: ${Object.keys(MODE_PROJECT_MAP).join(', ')}`);
    process.exit(1);
  }

  // Load scripts/.env.{mode} into process.env (REDIS_URL, TELEGRAM_BOT_TOKEN, etc.)
  initScriptsEnv(mode);

  const projectId = resolveProjectId(mode);
  const deployableSet = new Set(DEPLOYABLE_APPS);

  let appsToDeploy: string[] = [];

  if (remainingArgs[0] === 'all') {
    // 'all' or 'all --force' → deploy everything
    appsToDeploy = [...DEPLOYABLE_APPS];
  } else if (isForce && remainingArgs.length === 0) {
    // --force alone (no specific apps) → deploy all
    appsToDeploy = [...DEPLOYABLE_APPS];
  } else if (remainingArgs.length === 0) {
    // Default: detect affected projects and deploy only those
    const allAffected = getAffectedProjects();
    const affected = allAffected.filter((name) => deployableSet.has(name));

    log(`\n${c.bold}🚀 Aikami Deploy${c.reset}`);
    log(`  Branch: ${branch} → ${c.cyan}${mode}${c.reset}`);
    log(`  Project: ${c.cyan}${projectId}${c.reset}\n`);

    if (affected.length === 0) {
      if (isCI) {
        warn('No affected deployable apps detected in CI — falling back to deploy all.');
        appsToDeploy = [...DEPLOYABLE_APPS];
      } else {
        log(`${c.yellow}No affected deployable apps detected.${c.reset}`);
        log(`  Affected projects (non-deployable): ${allAffected.join(', ') || '(none)'}`);
        log(`  Use ${c.bold}--force${c.reset} or ${c.bold}all${c.reset} to deploy everything.`);
        process.exit(0);
      }
    } else {
      log(`${c.bold}Affected apps to deploy:${c.reset}`);
      for (const app of affected) {
        const config = APP_CONFIG[app as keyof typeof APP_CONFIG];
        if (config) {
          log(`  ${c.bold}${app}${c.reset} ${c.dim}(${config.serviceType})${c.reset}`);
        }
      }
      log('');

      if (!_autoYes) {
        const answer = await confirm('Deploy affected apps?');
        if (!answer) {
          error('Cancelled.');
          process.exit(1);
        }
      }
      _autoYes = true; // Confirmed above — skip the generic "Proceed" prompt below
      appsToDeploy = affected;
    }
  } else {
    appsToDeploy = remainingArgs.filter((app) => deployableSet.has(app));
    const unknown = remainingArgs.filter((app) => !deployableSet.has(app));
    if (unknown.length > 0) {
      warn(`Unknown apps: ${unknown.join(', ')}`);
    }
  }

  if (appsToDeploy.length === 0) {
    error('No apps to deploy.');
    process.exit(1);
  }

  log(`\n${c.bold}Deploy Summary${c.reset}`);
  log(`  Mode:    ${c.cyan}${mode}${c.reset}`);
  log(`  Project: ${c.cyan}${projectId}${c.reset}`);
  log(`  Force:   ${isForce ? `${c.yellow}yes (bypass checksums)${c.reset}` : 'no'}`);
  log(`  Verbose: ${isVerbose() ? `${c.green}yes${c.reset}` : 'no'}`);
  log(`  Apps:    ${c.bold}${appsToDeploy.join(', ')}${c.reset}\n`);

  // Prompt for confirmation for --force / 'all' (bulk deploys).
  const isBulk = isForce || remainingArgs[0] === 'all';
  if (isBulk && !_autoYes) {
    const proceed = await confirm('Proceed with deployment?');
    if (!proceed) {
      error('Deployment cancelled.');
      process.exit(1);
    }
  }

  // No GCP auth gate here (C-441 removed GSM; every currently-enabled app
  // is either a Cloudflare Worker or a D1 migration, neither needs GCP).
  // docker-release apps authenticate their own Artifact Registry access via
  // authenticateDocker() inside docker_release.ts when that path actually
  // runs — see deployDockerRelease().

  // ── Pre-flight: Check deployment caches (before any builds) ──
  log(`\n${c.bold}Checking deployment caches...${c.reset}`);

  // CI passes --version explicitly when reusing a shared build (see
  // --skip-build-for below) so the embedded version matches byte-for-byte;
  // local runs and normal CI runs fall back to the usual fresh version.
  const version = (opts.version as string | undefined) || generateVersionString();
  const cachedApps = new Set<string>();
  const preflightChecksums = new Map<string, string>();

  for (const appName of appsToDeploy) {
    const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
    if (!config) {
      continue;
    }

    // database-migration doesn't use checksum caching — migrations are
    // idempotent, and a cache hit must never silently skip a pending migration.
    if (config.serviceType === 'infra') {
      continue;
    }

    const cache = await checkDeployCache(config, appName, mode, ROOT_DIR, isForce);
    if (cache.skip) {
      ok(`  ${appName} is up to date (cache hit: ${cache.source}). Skipping.`);
      cachedApps.add(appName);
    } else {
      // Store pre-flight checksum — this is the checksum the NEXT deploy will
      // compute (pre-build state), so it must match what we save post-deploy.
      preflightChecksums.set(appName, cache.checksum);
    }
  }

  if (cachedApps.size > 0) {
    appsToDeploy = appsToDeploy.filter((a) => !cachedApps.has(a));
  }

  if (appsToDeploy.length === 0) {
    ok(`\n✨ All requested apps are up to date! Nothing to deploy.`);
    process.exit(0);
  }

  // ── Phase 1: Sequential moon builds (deduplicated by build project) ──
  // Moon processes lock files in the workspace, so builds must be serialized.
  // Build targets are deduplicated so 'client' and 'client-tauri' (which both
  // use buildProject 'client') only trigger a single moon build.
  // Docker builds, pushes, and gcloud deploys can still run in parallel (Phase 2).
  log(`\n${c.bold}Phase 1: Building apps (sequential)...${c.reset}`);

  // CI-only: targets to skip because a shared build artifact was already
  // downloaded into place for them (see --skip-build-for in the header
  // comment). Empty on every local run.
  const skipBuildTargets = new Set(
    ((opts['skip-build-for'] as string | undefined) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Enforce that --version is explicitly provided when skipping builds —
  // otherwise deployment proceeds with a fresh generateVersionString() that
  // doesn't match the reused pre-built artifacts.
  if (skipBuildTargets.size > 0 && !opts.version) {
    error(
      '--skip-build-for requires --version to be explicitly provided. ' +
        'The version must match the shared build artifacts being reused.',
    );
    process.exit(1);
  }

  // Collect unique moon build targets
  const targetsToBuild = new Map<string, string>(); // moonTarget → representative appName

  for (const appName of appsToDeploy) {
    const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
    if (!config) {
      continue;
    }
    const needsBuild = config.serviceType !== 'docker-release' && config.needsDist !== false;
    if (needsBuild) {
      const moonTarget = config.buildProject ?? appName;
      if (!targetsToBuild.has(moonTarget)) {
        targetsToBuild.set(moonTarget, appName);
      }
    }
  }

  const buildFailed = new Set<string>();
  const buildFailedTargets = new Set<string>();
  const results: AppResult[] = [];
  const errors: string[] = [];

  for (const [moonTarget, appName] of targetsToBuild) {
    if (skipBuildTargets.has(moonTarget)) {
      ok(`  ${moonTarget} build skipped — reusing a pre-built shared bundle (for ${appName})`);
      continue;
    }
    try {
      log(`  🏗️  Building ${c.cyan}${moonTarget}:build${c.reset} (for ${appName})...`);
      const forceFlag = isForce ? ' --force' : '';
      // env option is cross-platform — VAR=value prefix is bash-only and breaks on Windows
      // live: stream moon's output so CI watchers see the build progressing
      // (moon build can take minutes on a cold cache).
      run(`bun moon run ${moonTarget}:build${forceFlag} -- --mode ${mode}`, {
        cwd: ROOT_DIR,
        env: { PUBLIC_APP_VERSION: version },
        live: true,
      });
      ok(`  ${moonTarget} built`);
    } catch (err) {
      error(`  ${moonTarget} build failed: ${(err as Error).message}`);
      buildFailedTargets.add(moonTarget);
    }
  }

  // Map target failures back to individual apps
  for (const appName of appsToDeploy) {
    const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
    const target = config?.buildProject ?? appName;
    if (buildFailedTargets.has(target)) {
      buildFailed.add(appName);
      errors.push(`Build failed for ${appName} (target ${target}:build)`);
      results.push({ name: appName, type: config?.serviceType ?? 'unknown', result: 'failure' });
    }
  }

  // ── Phase 2: Parallel deploys (skip apps whose build failed) ───────────
  log(`\n${c.bold}Phase 2: Deploying apps (parallel)...${c.reset}`);

  const deployableApps = appsToDeploy.filter((a) => !buildFailed.has(a));
  if (deployableApps.length === 0) {
    error('All apps failed to build. Nothing to deploy.');
    process.exit(1);
  }

  const deployPromises = deployableApps.map(async (appName) => {
    const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
    if (!config) {
      errors.push(`No config found for ${appName}`);
      results.push({ name: appName, type: 'unknown', result: 'failure' });
      return;
    }
    try {
      const result = await deployApp(
        config,
        appName,
        mode,
        ROOT_DIR,
        version,
        isForce,
        preflightChecksums.get(appName),
      );
      results.push({ name: appName, type: config.serviceType, result });
    } catch (err) {
      errors.push(`Deploy failed for ${appName}: ${(err as Error).message}`);
      results.push({ name: appName, type: config.serviceType, result: 'failure' });
    }
  });

  await Promise.all(deployPromises);

  if (errors.length > 0) {
    error(`\n❌ ${errors.length} deployment(s) failed:`);
    for (const msg of errors) {
      error(`  - ${msg}`);
    }
    process.exit(1);
  }

  ok(`\n✅ All deployments complete!`);

  // ── Telegram Notification (if --notify flag) ──
  if (shouldNotify) {
    const botToken = getScriptsEnv('TELEGRAM_BOT_TOKEN');
    const chatId = getScriptsEnv('TELEGRAM_CHAT_ID');
    if (botToken && chatId) {
      try {
        const notificationInput: NotificationInput = {
          botToken,
          chatId,
          branch,
          sha: shortSha(40),
          actor: process.env.USER || 'local',
          commitMessage: run('git log -1 --pretty=%B', { quiet: true }),
          apps: results,
        };
        await notifyDeployment(notificationInput);
      } catch (err) {
        warn(`Telegram notification failed: ${(err as Error).message}`);
      }
    } else {
      warn('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping notification');
    }
  }
}

await main();
