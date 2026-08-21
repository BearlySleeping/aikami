// scripts/src/lib/deploy/cloudflare.ts
/**
 * Cloudflare Worker deployment — the single source of truth for deploying
 * the static sites (client, site, docs) and the SSR hub to Cloudflare.
 *
 * Path:
 *  1. Checksum check (skip if unchanged)
 *  2. Build via moon (Phase 1 usually already did this — we skip if output exists)
 *  3. Ensure a `_headers` file lands in the build output for cache/security headers
 *  4. `wrangler deploy` with a per-mode `wrangler.jsonc`
 *
 * Each app is deployed as its own Worker (see deployment_config.ts → `cloudflare`).
 * - Assets-only Workers (client, site, docs) have no `main` — purely static
 *   assets served from the edge. Wrangler uploads `assets.directory`.
 * - The hub is an SSR Worker built by @sveltejs/adapter-cloudflare, so it has a
 *   `main` worker entry + `nodejs_compat`.
 *
 * Custom domains (routes) require the zone to be on Cloudflare — true for
 * bearlysleeping.com. Each Worker is deployed to its `*.workers.dev` subdomain
 * first, then the `custom_domain` route is applied.
 *
 * NOTE (C-42x): the hub's server data plane uses `pg` (node-postgres) to reach
 * Neon Postgres, which needs raw `node:net` sockets that a plain Worker does not
 * support. We are NOT wiring Neon into the Worker yet — the hub is deployed
 * without database connectivity. When the hub needs Postgres, add a Hyperdrive
 * binding and point connection.ts at the Hyperdrive connection string.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppId } from '../../../../packages/shared/types/src/index.ts';
import { c, log, ok } from '../cli_utils';
import { checkDeployCache, saveDeployCache } from './cache';
import {
  type AppConfig,
  resolveCloudflareRoute,
  resolveCloudflareWorkerName,
} from './deployment_config';
import { isVerbose, run } from './utils'; // ── Cache/security headers (mirror of the old Firebase Hosting config) ──

/**
 * Canonical cache + security headers, expressed as a Workers `_headers` file.
 *
 * The catch-all `/*` rule revalidates HTML (never-cached index), while
 * fingerprinted bundles / hashed static assets get a long immutable cache.
 * These match the headers previously defined in each app's `firebase.json`.
 */
export const WORKERS_HEADERS = `/*
  Cache-Control: public, max-age=0, must-revalidate
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/_app/immutable/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/_astro/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/pagefind/*
  ! Cache-Control
  Cache-Control: public, max-age=86400

/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.@(js|css|webp|png|jpg|jpeg|svg|woff|woff2|avif|gif|ico|ttf|eot|mp3|ogg|wav|flac|m4a|aac|txt|pdf|json)
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`;

/**
 * Ensure the `_headers` file exists in the app's build output before deploy.
 * Wrangler reads `_headers` from the asset directory root.
 *
 * Only applies to assets-only Workers (client/site/docs). The hub is an SSR
 * Worker whose adapter already emits its own `_headers` — overwriting it here
 * would clobber the SvelteKit immutable asset rules.
 */
export function ensureHeadersFile(config: AppConfig, appRoot: string): void {
  const cf = config.cloudflare;
  if (!cf?.assetsOnly) {
    return;
  }
  const outputDir = join(appRoot, cf.buildOutputDir);
  if (!existsSync(outputDir)) {
    return;
  }
  const headersPath = join(outputDir, '_headers');
  writeFileSync(headersPath, WORKERS_HEADERS, 'utf-8');
  log(`  📝 Wrote cache/security headers to ${headersPath}`);
}

/**
 * Generate a per-mode wrangler.jsonc in the app directory.
 *
 * `wrangler deploy` discovers `wrangler.jsonc` from the current directory, so
 * we write one per deploy (mode-specific worker name + route) and clean it up
 * afterwards — the committed repo keeps a static template, and the dynamic
 * per-mode values come from deployment_config.ts (single source of truth).
 */
export function writeWranglerConfig(config: AppConfig, appRoot: string, mode: string): string {
  const cf = config.cloudflare;
  if (!cf) {
    throw new Error(`No cloudflare config for app`);
  }
  const workerName = typeof cf.workerName === 'function' ? cf.workerName(mode) : cf.workerName;
  const liveMode = mode as keyof typeof cf.routes;
  const route = cf.routes?.[liveMode];

  const assetDir = cf.buildOutputDir;
  const json: Record<string, unknown> = {
    $schema: './node_modules/wrangler/config-schema.json',
    name: workerName,
    compatibility_date: cf.compatibilityDate,
  };

  if (cf.compatibilityFlags?.length) {
    json.compatibility_flags = cf.compatibilityFlags;
  }

  if (cf.assetsOnly) {
    json.assets = {
      directory: assetDir,
      html_handling: 'auto-trailing-slash',
      not_found_handling: '404-page',
    };
  } else {
    json.main = cf.main;
    json.assets = { binding: 'ASSETS', directory: assetDir };
  }

  const routes: Array<Record<string, unknown>> = [];
  if (route) {
    routes.push({ pattern: route, custom_domain: true });
  }
  if (routes.length > 0) {
    json.routes = routes;
  }

  const configPath = join(appRoot, 'wrangler.jsonc');
  writeFileSync(configPath, JSON.stringify(json, null, 2), 'utf-8');
  log(`  📝 Wrote ${configPath} (worker=${workerName}, route=${route ?? '(none)'})`);
  return configPath;
}

/**
 * Deploy an app to Cloudflare Workers.
 *
 * @param config      App config (must have `.cloudflare`)
 * @param appName     App id (e.g. 'client', 'site', 'docs', 'hub')
 * @param mode        Deployment mode (staging / production)
 * @param rootDir     Repo root
 * @param version     Version string (for checksum cache)
 * @param isForce     Bypass checksum cache
 * @param preflightChecksum Pre-computed checksum from the orchestrator
 */
export async function deployCloudflareWorker(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  version: string,
  isForce = false,
  preflightChecksum?: string,
): Promise<void> {
  if (!config.cloudflare) {
    throw new Error(`App ${appName} has no cloudflare config`);
  }

  const workerName = resolveCloudflareWorkerName(appName as AppId, mode) ?? config.shortName;
  const route = resolveCloudflareRoute(appName as AppId, mode);

  log(`\n${c.bold}⛅ Deploying ${appName} to Cloudflare Workers${c.reset}`);
  log(`  Worker: ${workerName}`);
  log(`  Route:  ${route ?? '(workers.dev only)'}\n`);

  // 0. Checksum cache — use pre-flight checksum when available (avoids
  //    recomputing after build, which may have a different dirty hash).
  let checksum: string;
  if (preflightChecksum !== undefined) {
    checksum = preflightChecksum;
    if (isVerbose()) {
      log(`  Using pre-flight checksum: ${checksum.slice(0, 16)}...`);
    }
  } else {
    const cache = await checkDeployCache(config, appName, mode, rootDir, isForce);
    if (cache.skip) {
      ok(`${appName} skipped (unchanged — cache hit: ${cache.source})`);
      return;
    }
    checksum = cache.checksum;
  }

  const appRoot = join(rootDir, config.path);
  const outputDir = join(appRoot, config.cloudflare.buildOutputDir);

  // 1. Build — skip if already built in Phase 1 (parallel deploy safety)
  if (existsSync(outputDir)) {
    log('🏗️  Build already done, skipping...');
  } else {
    log(`🏗️  Building (mode: ${mode})...`);
    const modeFlag = ` -- --mode ${mode}`;
    const forceFlag = isForce ? ' --force' : '';
    run(`bunx moon run ${appName}:build${forceFlag}${modeFlag}`, { cwd: rootDir });

    if (!existsSync(outputDir)) {
      throw new Error(
        `Build output directory not found: ${outputDir}. Build may have failed or produced no assets.`,
      );
    }
  }

  // 2. Ensure cache/security headers are in the build output.
  ensureHeadersFile(config, appRoot);

  // 3. Write the per-mode wrangler.jsonc.
  const configPath = writeWranglerConfig(config, appRoot, mode);

  // 4. Deploy with wrangler (resolves via the scripts devDependency).
  //    Wrangler reads wrangler.jsonc from cwd. CLOUDFLARE_API_TOKEN / OAuth
  //    profile is used for auth.
  try {
    log(`⛅ Deploying Worker ${workerName}...`);
    const cwd = resolve(appRoot);
    const args = ['bunx', 'wrangler', 'deploy', '--config', configPath];
    run(args.join(' '), { cwd });

    // 5. Save checksum on success — use the pre-build consistent checksum.
    await saveDeployCache(mode, appName, checksum, version);
    ok(`${appName} deployed to Cloudflare (${workerName})`);
  } finally {
    // 6. Cleanup the generated wrangler.jsonc so we don't pollute git.
    try {
      run(`rm -f ${configPath}`, { quiet: true, cwd: resolve(appRoot) });
    } catch {
      // ignore cleanup failure
    }
  }
}
