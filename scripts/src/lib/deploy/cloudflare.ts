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

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { toMode } from '@aikami/utils';
import type { AppId } from '../../../../packages/shared/types/src/index.ts';
import { c, log, ok } from '../cli_utils';
import { checkDeployCache, generateVersionString, saveDeployCache } from './cache';
import {
  APP_CONFIG,
  type AppConfig,
  resolveCloudflareRoute,
  resolveCloudflareWorkerName,
} from './deployment_config';
import { isVerbose, parseEnvKeys, run, setVerbose } from './utils'; // ── Cache/security headers (mirror of the old Firebase Hosting config) ──

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

/*.js
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.css
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.webp
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.png
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.jpg
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.jpeg
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.svg
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.woff
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.woff2
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.avif
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.gif
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.ico
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.ttf
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.eot
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.mp3
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.ogg
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.wav
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.flac
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.m4a
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.aac
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.txt
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.pdf
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/*.json
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`;

/**
 * Security headers appended to the hub's adapter-generated `_headers`.
 * The hub is an SSR Worker whose adapter already emits its own immutable
 * asset rules — we must NOT clobber those, so we append only the security
 * block (HSTS, nosniff, XFO, Referrer-Policy, COOP, Permissions-Policy).
 */
export const WORKERS_SECURITY_HEADERS = `
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;

/**
 * Ensure the `_headers` file exists in the app's build output before deploy.
 * Wrangler reads `_headers` from the asset directory root.
 *
 * - Assets-only Workers (client/site/docs): write the full WORKERS_HEADERS
 *   (cache + security).
 * - SSR Workers (hub): the adapter already emits its own `_headers` with the
 *   SvelteKit immutable asset rules — append only the security block so we
 *   don't clobber those rules.
 */
export function ensureHeadersFile(config: AppConfig, appRoot: string): void {
  const cf = config.cloudflare;
  if (!cf) {
    return;
  }
  // For SSR Workers (hub), write _headers to the assets directory (cf.assetsDir)
  // which is uploaded by wrangler as the public static directory. For assets-only
  // Workers, write to buildOutputDir (the single directory for everything).
  const targetDir = cf.assetsOnly
    ? join(appRoot, cf.buildOutputDir)
    : join(appRoot, cf.assetsDir ?? cf.buildOutputDir);
  if (!existsSync(targetDir)) {
    return;
  }
  const headersPath = join(targetDir, '_headers');

  // When a headersSource is configured, copy it into the build output so the
  // committed source of truth is what ships. This preserves the existing
  // default (the generated WORKERS_HEADERS) only when no source is specified.
  if (cf.headersSource) {
    const sourcePath = join(appRoot, cf.headersSource);
    if (existsSync(sourcePath)) {
      writeFileSync(headersPath, readFileSync(sourcePath, 'utf-8'), 'utf-8');
      log(`  📝 Copied headers from ${cf.headersSource} to ${headersPath}`);
      return;
    }
    log(`  ⚠️  headersSource ${cf.headersSource} not found — falling back to defaults`);
  }

  if (cf.assetsOnly) {
    writeFileSync(headersPath, WORKERS_HEADERS, 'utf-8');
    log(`  📝 Wrote cache/security headers to ${headersPath}`);
    return;
  }

  // SSR app (hub): append security headers to the adapter's file.
  const existing = existsSync(headersPath) ? readFileSync(headersPath, 'utf-8') : '';
  if (existing.includes('Strict-Transport-Security')) {
    log(`  📝 Security headers already present in ${headersPath}`);
    return;
  }
  writeFileSync(headersPath, existing + WORKERS_SECURITY_HEADERS, 'utf-8');
  log(`  📝 Appended security headers to ${headersPath}`);
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
      not_found_handling: cf.notFoundHandling ?? '404-page',
    };
  } else {
    json.main = cf.main;
    // SSR Workers serve their static client assets from `assetsDir` (e.g.
    // `build/client`), NOT `buildOutputDir` — the latter also contains the
    // server `_worker.js`, which must never be uploaded as a public asset.
    json.assets = { binding: 'ASSETS', directory: cf.assetsDir ?? assetDir };
    // C-426 AC-3: SSR Workers (hub) need their D1 + R2 bindings and the
    // nodejs_compat flag in the generated per-mode wrangler config.
    const d1Databases =
      typeof cf.d1Databases === 'function' ? cf.d1Databases(mode) : cf.d1Databases;
    if (d1Databases?.length) {
      json.d1_databases = d1Databases.map((d) => ({
        binding: d.binding,
        database_name: d.databaseName,
        database_id: d.databaseId,
      }));
    }
    const r2Buckets = typeof cf.r2Buckets === 'function' ? cf.r2Buckets(mode) : cf.r2Buckets;
    if (r2Buckets?.length) {
      json.r2_buckets = r2Buckets.map((r) => ({
        binding: r.binding,
        bucket_name: r.bucketName,
      }));
    }
    const vars = typeof cf.vars === 'function' ? cf.vars(mode) : cf.vars;
    // Inject LOG_LEVEL from the mode's .env.{mode} so the SSR logger's
    // `process.env.LOG_LEVEL` is set at runtime. The Worker only receives the
    // vars declared here — .env.production is NOT otherwise injected into the
    // Worker (it only feeds the Vite build), so without this the logger would
    // silently default to INFO and DEBUG diagnostics would never surface.
    const envVars = parseEnvKeys(join(appRoot, `.env.${mode}`));
    const mergedVars = {
      ...(vars ?? {}),
      ...(envVars.LOG_LEVEL ? { LOG_LEVEL: envVars.LOG_LEVEL } : {}),
    };
    if (mergedVars && Object.keys(mergedVars).length > 0) {
      json.vars = mergedVars;
    }
  }

  // Workers Observability — without this, logs are disabled and there is no
  // way to debug the Worker at runtime.
  json.observability = { enabled: true };

  const routes: Array<Record<string, unknown>> = [];
  if (route) {
    routes.push({ pattern: route, custom_domain: true });
  }
  if (routes.length > 0) {
    json.routes = routes;
  }

  // Write to a generated file (gitignored) rather than the committed
  // wrangler.jsonc template — the template is the canonical per-app config
  // and must never be clobbered or deleted by a deploy.
  const configPath = join(appRoot, 'wrangler.deploy.json');
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
 * @param alreadyBuilt True when the caller (orchestrator) already built this
 *                     app in an earlier phase. When false, the deploy builds
 *                     only if the output directory is missing. Never infer
 *                     "already built" from directory existence alone — a
 *                     stale build from a different mode could otherwise be
 *                     shipped to the wrong environment.
 */
export async function deployCloudflareWorker(
  config: AppConfig,
  appName: string,
  mode: string,
  rootDir: string,
  version: string,
  isForce = false,
  preflightChecksum?: string,
  alreadyBuilt = false,
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

  // 1. Build — the orchestrator already built in Phase 1 (parallel deploy
  //    safety); the per-app script builds only when the output is missing.
  //    The output-exists skip is gated on preflightChecksum being defined:
  //    only an orchestrated Phase 1 build can be trusted to have produced a
  //    mode-correct output. Direct invocations (no preflightChecksum) always
  //    run the mode-specific build so a stale build from another mode can
  //    never be shipped to the wrong environment.
  if (alreadyBuilt) {
    log('🏗️  Build already done (orchestrator Phase 1), skipping...');
  } else if (preflightChecksum !== undefined && existsSync(outputDir)) {
    log('🏗️  Build output exists, skipping...');
  } else {
    log(`🏗️  Building (mode: ${mode})...`);
    const modeFlag = ` -- --mode ${mode}`;
    const forceFlag = isForce ? ' --force' : '';
    run(`bun moon run ${appName}:build${forceFlag}${modeFlag}`, { cwd: rootDir });

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
      rmSync(configPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

/**
 * Shared Cloudflare deployment CLI entrypoint for the per-app deploy scripts
 * (site, hub). Owns argument parsing, the APP_CONFIG Cloudflare guard, the
 * deployment invocation, and error handling so each app script stays a thin
 * one-liner.
 *
 * @param appName The app id (e.g. 'site', 'hub').
 */
export async function deployCloudflareApp(appName: AppId): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      mode: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.verbose) {
    setVerbose(true);
  }

  const mode = toMode(values.mode || process.env.MODE);
  if (!mode) {
    console.error('Missing --mode argument or MODE env var');
    process.exit(1);
  }

  const config = APP_CONFIG[appName];
  if (!config?.cloudflare) {
    console.error(`No cloudflare config for ${appName}`);
    process.exit(1);
  }

  // Repo root = 4 levels up from apps/frontend/<app>/scripts/deploy.ts
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

  try {
    await deployCloudflareWorker(config, appName, mode, rootDir, generateVersionString(), false);
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    console.error(err.stderr ?? err.message ?? String(error));
    process.exit(1);
  }
}
