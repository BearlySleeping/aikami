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
 *   Tauri Release (client)           → checksum → build web → cargo tauri build → upload to GCS
 *   Firebase Hosting (site, docs)    → checksum → build (moon) → deploy via moon
 *   Firebase Functions (firebase)    → deploy via moon (firestack)
 *   Docker Release (image,text,voice)→ checksum → docker build → push
 */

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { c, error, log, ok, parseCliArgs, setLogQuiet, warn } from '../cli_utils';
import { deployCloudRunSveltekit } from './cloud_run';
import {
  APP_CONFIG,
  type AppConfig,
  DEPLOYABLE_APPS,
  liveModes,
  MODE_PROJECT_MAP,
} from './deployment_config';
import { deployDockerRelease } from './docker_release';
import { deployFirebaseFunctions, deployFirebaseHosting } from './firebase';
import { type AppResult, type NotificationInput, notifyDeployment } from './notification';
import { deployTauriRelease } from './tauri_release';
import {
  authenticateDocker,
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

async function deployApp(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  isForce = false,
): Promise<'success' | 'failure'> {
  switch (config.serviceType) {
    case 'cloud-run-sveltekit':
      await deployCloudRunSveltekit(config, appName, mode, rootDir, isForce);
      return 'success';
    case 'tauri-release':
      await deployTauriRelease(config, appName, mode, rootDir, isForce);
      return 'success';
    case 'firebase-hosting':
      await deployFirebaseHosting(config, appName, mode, rootDir, isForce);
      return 'success';
    case 'firebase-functions':
      await deployFirebaseFunctions(config, appName, mode, rootDir, isForce);
      return 'success';
    case 'docker-release':
      await deployDockerRelease(config, appName, mode, rootDir, isForce);
      return 'success';
    default:
      warn(`Unknown service type "${(config as AppConfig).serviceType}" for ${appName}. Skipping.`);
      return 'success';
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

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

  // Auth check
  const authCheck = run('gcloud auth print-access-token', { quiet: true });
  if (!authCheck) {
    error('Not authenticated with gcloud. Run: gcloud auth login');
    process.exit(1);
  }

  authenticateDocker();

  // ── Phase 1: Sequential moon builds (moon conflicts when run in parallel) ──
  // Moon processes lock files in the workspace, so builds must be serialized.
  // Docker builds, pushes, and gcloud deploys can still run in parallel (Phase 2).
  log(`\n${c.bold}Phase 1: Building apps (sequential)...${c.reset}`);
  const buildFailed = new Set<string>();
  const results: AppResult[] = [];
  const errors: string[] = [];
  for (const appName of appsToDeploy) {
    const config = APP_CONFIG[appName as keyof typeof APP_CONFIG];
    if (!config) {
      warn(`No config found for "${appName}" — skipping`);
      errors.push(`No config found for ${appName}`);
      results.push({ name: appName, type: 'unknown', result: 'failure' });
      continue;
    }
    const needsBuild =
      config.serviceType !== 'docker-release' &&
      config.serviceType !== 'firebase-functions' &&
      config.needsDist !== false;
    if (needsBuild) {
      try {
        log(`  🏗️  ${appName}...`);
        const ver = shortSha();
        const needsModeFlag =
          config.serviceType === 'cloud-run-sveltekit' || config.serviceType === 'firebase-hosting';
        const modeFlag = needsModeFlag && mode !== 'production' ? ` -- --mode ${mode}` : '';
        const forceFlag = isForce ? ' --force' : '';
        run(`PUBLIC_APP_VERSION=${ver} bunx moon run ${appName}:build${forceFlag}${modeFlag}`, {
          cwd: ROOT_DIR,
        });
        ok(`  ${appName} built`);
      } catch (err) {
        error(`  ${appName} build failed: ${(err as Error).message}`);
        buildFailed.add(appName);
        errors.push(`Build failed for ${appName}: ${(err as Error).message}`);
        results.push({ name: appName, type: config.serviceType, result: 'failure' });
      }
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
      const result = await deployApp(config, appName, mode, ROOT_DIR, isForce);
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
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
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
