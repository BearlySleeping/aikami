// scripts/src/lib/deploy/deployment_config.ts
/**
 * Global deployment configuration for the Aikami monorepo.
 *
 * Single source of truth for:
 * - App deployment metadata (service types, paths, names, regions, site IDs)
 * - Secret management configuration (prefixes, mode mappings)
 *
 * Imports project IDs from shared constants (relative path, no alias)
 * to keep a single source of truth across all apps.
 *
 * Service types:
 *   cloudflare-worker    → Build → `wrangler deploy` → Cloudflare Worker (client, site, docs)
 *   tauri-release        → Build Tauri desktop app → release artifacts
 *   docker-release       → Docker build + push only (image, text, voice)
 *   database-migration   → Apply server-plane migrations against Neon
 */

import { MODE_PROJECT_MAP, modes } from '../../../../packages/shared/constants/src/lib/project.ts';
import type { AppId } from '../../../../packages/shared/types/src/index.ts';

export const ALL_SERVICE_TYPES = [
  'cloudflare-worker',
  'tauri-release',
  'docker-release',
  'database-migration',
] as const;

export type ServiceType = (typeof ALL_SERVICE_TYPES)[number];

/**
 * Cloudflare Worker deployment config.
 *
 * `workerName` and `routes`/`customDomains` may be per-mode since each
 * environment (staging vs production) gets its own Worker and domain.
 *
 * - `buildOutputDir`: directory (relative to the app root) that `wrangler deploy`
 *   uploads as the Worker's static assets (`assets.directory`). For Astro apps
 *   that's `dist`; for the SvelteKit client it's `build`.
 * - `assetsOnly`: true for the static sites — no `main` worker, purely static
 *   assets served from the edge. false (hub) for a real SSR Worker.
 * - `main`: worker entry for non-assets-only apps (hub). Relative to app root.
 * - `compatibilityDate` / `compatibilityFlags`: Workerd runtime compat.
 * - `routes`: per-mode custom_domain routes. Worker custom domains require the
 *   zone to be on Cloudflare (true for bearlysleeping.com).
 */
export type CloudflareAppConfig =
  | {
      /** Worker name (per mode, e.g. aikami-staging-client / aikami-production-client). */
      workerName: string | ((mode: string) => string);
      /** Directory of static build output (relative to app root). */
      buildOutputDir: string;
      /** True for assets-only static Workers (no `main`). */
      assetsOnly: true;
      compatibilityDate: string;
      compatibilityFlags?: string[];
      /** Per-mode custom-domain route patterns (e.g. hub.bearlysleeping.com). */
      routes: Partial<Record<LiveMode, string>>;
      /** `_headers` filename placed into the build output dir. Default 'public/_headers' or 'static/_headers'. */
      headersSource?: string;
      /**
       * How the Worker handles requests for paths with no matching asset.
       * - '404-page': serve a 404.html (Astro/Starlight — real file per route).
       * - 'single-page-application': serve index.html (SvelteKit adapter-static
       *   with `fallback: 'index.html'` — client deep links must resolve to the SPA).
       * Defaults to '404-page'.
       */
      notFoundHandling?: '404-page' | 'single-page-application';
    }
  | {
      /** Worker name (per mode, e.g. aikami-staging-hub / aikami-production-hub). */
      workerName: string | ((mode: string) => string);
      /** Directory of static build output (relative to app root). */
      buildOutputDir: string;
      /** False for SSR Workers (hub) — requires `main`. */
      assetsOnly: false;
      /** Worker entry for SSR apps (hub). Relative to app root. */
      main: string;
      /**
       * Directory of static client assets served by the Worker (relative to
       * app root). For SvelteKit SSR apps this is the adapter's client output
       * (e.g. `build/client`), NOT `buildOutputDir` (which also contains the
       * server `_worker.js`). Defaults to `buildOutputDir` when omitted.
       */
      assetsDir?: string;
      compatibilityDate: string;
      compatibilityFlags?: string[];
      /** Per-mode custom-domain route patterns (e.g. hub.bearlysleeping.com). */
      routes: Partial<Record<LiveMode, string>>;
      /** `_headers` filename placed into the build output dir. Default 'public/_headers' or 'static/_headers'. */
      headersSource?: string;
      /** D1 database bindings emitted into the generated wrangler config (per-mode or shared). */
      d1Databases?:
        | Array<{ binding: string; databaseName: string; databaseId: string }>
        | ((mode: string) => Array<{ binding: string; databaseName: string; databaseId: string }>);
      /** R2 bucket bindings emitted into the generated wrangler config (per-mode or shared). */
      r2Buckets?:
        | Array<{ binding: string; bucketName: string }>
        | ((mode: string) => Array<{ binding: string; bucketName: string }>);
      /**
       * Plain-text env vars emitted into the generated wrangler config
       * (`vars`). For non-secret runtime config the SSR Worker reads via
       * `$env/dynamic/private` (e.g. CATALOG_ORIGIN_URL). Per-mode or shared.
       */
      vars?: Record<string, string> | ((mode: string) => Record<string, string>);
    };

export type AppConfig = {
  serviceType: ServiceType;
  /** Relative path from repo root */
  path: string;
  /** Short identifier used in docker tags, URLs, etc. Empty string = default hosting. */
  shortName: string;
  /** Set to false to exclude from deployment. Default: true. */
  enabled?: boolean;
  /** Env var prefix for app-specific secrets in GCP Secret Manager */
  prefix?: string;
  /** Branches that are allowed to deploy this app. If omitted, all branches. */
  deployBranches?: string[];
  /** GCP region override. Defaults to the global region variable. */
  region?: string;
  /** Cloud Run CPU allocation (e.g. '1', '2', '4'). Default: not set. */
  cpu?: string;
  /** Cloud Run memory allocation (e.g. '1Gi', '4Gi'). Default: '1Gi'. */
  memory?: string;
  /** Cloud Run service ID override. Defaults to `aikami-${shortName}`. */
  cloudRunServiceId?: string;
  /**
   * Firebase Hosting site ID override per mode. Defaults to
   * `{projectId}-{shortName}` (or `{projectId}` for the default site).
   * Needed when the derived name is globally unavailable.
   */
  hostingSiteIds?: Partial<Record<LiveMode, string>>;
  /** VPC connector for Cloud SQL access (Cloud Run). */
  vpcConnector?: string;
  /** Cloud SQL instance for the Auth Proxy (Cloud Run). */
  cloudSqlInstance?: string;
  /** Whether to expect a dist/ directory after moon build. Default true. */
  needsDist?: boolean;
  /** Docker image name override. Defaults to aikami/${shortName}. */
  imageName?: string;
  /** Docker build context path override. Defaults to path. */
  dockerContext?: string;
  /** Moon project ID override for the build phase. Defaults to the app name itself.
   *  Used when the deploy app (e.g. 'client-tauri') isn't a standalone moon project
   *  but reuses another project's build (e.g. 'client'). */
  buildProject?: string;
  /**
   * Custom domains served by this app, per live mode. For Cloudflare Worker
   * apps these are mirrored in `cloudflare.routes` (the actual deploy target);
   * kept here as the canonical domain mapping for reference and tooling.
   */
  customDomains?: Partial<Record<LiveMode, string>>;
  /**
   * Cloudflare Worker deployment config. Present on apps whose serviceType is
   * `cloudflare-worker` (client, site, docs).
   */
  cloudflare?: CloudflareAppConfig;
};

export const APP_CONFIG: Readonly<Record<AppId, AppConfig>> = {
  client: {
    serviceType: 'cloudflare-worker',
    path: 'apps/frontend/client',
    shortName: 'client',
    prefix: 'CLIENT',
    // Staging domain intentionally omitted — not recorded anywhere in the repo.
    customDomains: {
      production: 'aikami.bearlysleeping.com',
    },
    cloudflare: {
      workerName: (mode) => (mode === 'production' ? 'aikami-client' : `aikami-${mode}-client`),
      buildOutputDir: 'build',
      assetsOnly: true,
      compatibilityDate: '2026-08-21',
      routes: {
        production: 'aikami.bearlysleeping.com',
      },
      headersSource: 'static/_headers',
      notFoundHandling: 'single-page-application',
    },
  },
  /** Tauri desktop release — reuses the client moon project for web build, then runs cargo tauri build. */
  'client-tauri': {
    serviceType: 'tauri-release',
    path: 'apps/frontend/client',
    shortName: 'client-desktop',
    prefix: 'CLIENT',
    buildProject: 'client',
  },
  site: {
    serviceType: 'cloudflare-worker',
    path: 'apps/frontend/site',
    shortName: '',
    prefix: 'SITE',
    customDomains: {
      production: 'bearlysleeping.com',
      staging: 'stg.bearlysleeping.com',
    },
    cloudflare: {
      workerName: (mode) => (mode === 'production' ? 'aikami-site' : `aikami-${mode}-site`),
      buildOutputDir: 'dist',
      assetsOnly: true,
      compatibilityDate: '2026-08-21',
      routes: {
        production: 'bearlysleeping.com',
        staging: 'stg.bearlysleeping.com',
      },
      headersSource: 'public/_headers',
    },
  },
  /** SvelteKit SSR dashboard — deployed as a Cloudflare Worker (C-426 AC-3), was Cloud Run. */
  hub: {
    serviceType: 'cloudflare-worker',
    path: 'apps/frontend/hub',
    shortName: 'hub',
    prefix: 'HUB',
    customDomains: {
      production: 'hub.bearlysleeping.com',
      staging: 'hub.stg.bearlysleeping.com',
    },
    cloudflare: {
      workerName: (mode) => (mode === 'production' ? 'aikami-hub' : `aikami-${mode}-hub`),
      buildOutputDir: 'build',
      assetsOnly: false,
      main: 'build/_worker.js',
      assetsDir: 'build/client',
      compatibilityDate: '2026-08-21',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: (mode) => [
        {
          binding: 'DB',
          databaseName: mode === 'production' ? 'aikami-hub' : `aikami-${mode}-hub`,
          // TODO: Provision separate D1 databases for staging and production to isolate
          // Better Auth user data and save-backup metadata across environments. For now,
          // both modes share the production database (bf77e365-058f-408f-871c-4a0567c9aa10).
          databaseId: 'bf77e365-058f-408f-871c-4a0567c9aa10',
        },
      ],
      r2Buckets: (mode) => [
        {
          binding: 'SAVES_BUCKET',
          bucketName: mode === 'production' ? 'aikami-saves' : `aikami-${mode}-saves`,
        },
      ],
      // Public catalog origin the hub reads the static index from (C-396).
      // Injected as a plain var (not a secret) — it's a public CDN URL.
      vars: () => ({ CATALOG_ORIGIN_URL: 'https://assets.bearlysleeping.com' }),
      routes: {
        production: 'hub.bearlysleeping.com',
        staging: 'hub.stg.bearlysleeping.com',
      },
    },
  },
  /** Starlight documentation site — static build deployed to its own Worker. */
  docs: {
    serviceType: 'cloudflare-worker',
    path: 'apps/frontend/docs',
    shortName: 'docs',
    prefix: 'DOCS',
    customDomains: {
      production: 'docs.bearlysleeping.com',
      staging: 'docs.stg.bearlysleeping.com',
    },
    cloudflare: {
      workerName: (mode) => (mode === 'production' ? 'aikami-docs' : `aikami-${mode}-docs`),
      buildOutputDir: 'dist',
      assetsOnly: true,
      compatibilityDate: '2026-08-21',
      routes: {
        production: 'docs.bearlysleeping.com',
        staging: 'docs.stg.bearlysleeping.com',
      },
      headersSource: 'public/_headers',
    },
  },
  image: {
    serviceType: 'docker-release',
    path: 'apps/backend/image',
    shortName: 'image',
    prefix: 'IMAGE',
    needsDist: false,
    memory: '8Gi',
    cpu: '4',
    enabled: false,
  },
  text: {
    serviceType: 'docker-release',
    path: 'apps/backend/text',
    shortName: 'text',
    prefix: 'TEXT',
    needsDist: false,
    memory: '8Gi',
    cpu: '4',
    enabled: false,
  },
  voice: {
    serviceType: 'docker-release',
    path: 'apps/backend/voice',
    shortName: 'voice',
    prefix: 'VOICE',
    needsDist: false,
    memory: '4Gi',
    cpu: '2',
    enabled: false,
  },
  /**
   * Always-on Compute Engine VM (Discord Gateway bot + Interactions
   * Endpoint) — see apps/backend/worker/README.md. Own build→push→restart
   * script (scripts/src/lib/worker/deploy.ts), NOT the generic docker-release
   * gcloud flow this service type otherwise implies — `enabled: false` is
   * what skips that. Listed here purely so download-secrets/upload-secrets
   * manage its .env.{mode} — same shape as image/text/voice above.
   */
  worker: {
    serviceType: 'docker-release',
    path: 'apps/backend/worker',
    shortName: 'worker',
    prefix: 'WORKER',
    needsDist: false,
    enabled: false,
  },
  /**
   * Server-data-plane migrations (C-394 AC-5). Not a service — this app
   * runs `wrangler d1 migrations apply` against the D1 database (C-436).
   * unpooled endpoint — DDL under PgBouncer transaction pooling breaks).
   *
   * The AppConfig hosting fields (shortName, imageName, customDomains …)
   * are meaningless for a migration job and are deliberately left unset.
   * `needsDist: false` keeps the deploy pipeline from attempting a moon
   * build. It is independently invocable and must NEVER run as a side
   * effect of deploying the hub — that coupling is exactly what C-385
   * removed when Data Connect stopped riding along with Firebase deploys.
   */
  database: {
    serviceType: 'database-migration',
    path: 'packages/backend/database',
    shortName: '',
    prefix: 'HUB',
    needsDist: false,
  },
};

export const DEPLOYABLE_APPS = Object.entries(APP_CONFIG)
  .filter(([, config]) => config.enabled !== false)
  .map(([key]) => key);

// ---------------------------------------------------------------------------
// Secret Management
// ---------------------------------------------------------------------------

export const APP_SPECIFIC_KEYS_FOR_PREFIX = new Set([
  'PUBLIC_APP_ID',
  'PUBLIC_FIREBASE_APP_ID',
  'PUBLIC_FIREBASE_MEASUREMENT_ID',
  'PUBLIC_RECAPTCHA_SITE_KEY',
  'PUBLIC_APP_CHECK_DEBUG_TOKEN',
  'PUBLIC_LOG_LEVEL',
  'PUBLIC_LOG_PERSIST_LEVEL',
  'LOG_PERSIST_LEVEL',
  'RECAPTCHA_SECRET_KEY',
  'APP_ID',
]);

/** Re-exported from shared constants for convenience. */
export { MODE_PROJECT_MAP };

/**
 * Modes that deploy to live GCP (not emulator), derived from the shared
 * `modes` tuple so disabling a mode there (e.g. commenting out staging)
 * removes it here too.
 */
export const liveModes = modes.filter(
  (mode): mode is Exclude<(typeof modes)[number], 'emulator' | 'testing'> =>
    mode !== 'emulator' && mode !== 'testing',
);
export type LiveMode = (typeof liveModes)[number];

/**
 * Maps deployment modes to release channels.
 *  - production → stable  (public download page)
 *  - staging    → beta    (testers)
 *  - emulator   → alpha   (internal dev builds)
 */
export const CHANNEL_MAP: Readonly<Record<string, string>> = {
  production: 'stable',
  staging: 'beta',
  emulator: 'alpha',
} as const;

export type Channel = (typeof CHANNEL_MAP)[keyof typeof CHANNEL_MAP];

/** Resolves the release channel name from a deployment mode. */
export const resolveChannel = (mode: string): string => CHANNEL_MAP[mode] ?? 'alpha';

export type SecretNameConfig = {
  prefix?: string;
};

export type ProjectSecretConfig = SecretNameConfig & {
  path: string;
  enabled?: boolean;
};

/**
 * Derived secret-upload config from APP_CONFIG to keep a single source of truth.
 * 'scripts' is added manually — it's not a deployable app but has its own secrets
 * (REDIS_URL, REDIS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
 */
export const PROJECT_ENV_CONFIG: Readonly<Record<string, ProjectSecretConfig>> = {
  ...Object.fromEntries(
    Object.entries(APP_CONFIG).map(([key, config]) => [
      key,
      {
        path: config.path,
        prefix: config.prefix,
        enabled: config.enabled ?? true,
      } satisfies ProjectSecretConfig,
    ]),
  ),
  scripts: {
    path: 'scripts',
    prefix: 'SCRIPTS',
    enabled: true,
  } satisfies ProjectSecretConfig,
};

/**
 * GCP region where Cloud Functions and Cloud Run services are deployed.
 * Must match the region used by the deploy pipeline.
 */
export const CLOUD_FUNCTIONS_REGION = 'europe-west1' as const;

export function resolveEnvFile(mode: string): string {
  return `.env.${mode}`;
}

export function resolveSecretName(key: string, config: SecretNameConfig): string {
  const needsPrefix = config.prefix && APP_SPECIFIC_KEYS_FOR_PREFIX.has(key);
  return needsPrefix ? `${config.prefix}_${key}` : key;
}

/**
 * Reverse-resolves a live mode from a project ID. Returns undefined for the
 * emulator (which has no Hosting sites) or an unknown project.
 */
export function resolveModeFromProjectId(projectId: string): LiveMode | undefined {
  return liveModes.find((mode) => MODE_PROJECT_MAP[mode] === projectId);
}

/**
 * Resolves the Firebase Hosting site ID for an app.
 *
 * Defaults to `{projectId}-{shortName}`, or `{projectId}` for the app that
 * owns the project's default site (site). Because Hosting site IDs are
 * globally unique across every Firebase project, the derived name is
 * sometimes unavailable — `hostingSiteIds` supplies a per-mode override in
 * that case (see the docs app).
 */
export function resolveHostingSiteId(appId: AppId, projectId: string): string | undefined {
  const config = APP_CONFIG[appId];
  if (!config) {
    return undefined;
  }
  const mode = resolveModeFromProjectId(projectId);
  const override = mode ? config.hostingSiteIds?.[mode] : undefined;
  if (override) {
    return override;
  }
  if (!config.shortName) {
    return projectId;
  }
  return `${projectId}-${config.shortName}`;
}

/**
 * Resolves the Cloudflare Worker name for an app + mode.
 */
export function resolveCloudflareWorkerName(appId: AppId, mode: string): string | undefined {
  const cf = APP_CONFIG[appId]?.cloudflare;
  if (!cf) {
    return undefined;
  }
  return typeof cf.workerName === 'function' ? cf.workerName(mode) : cf.workerName;
}

/**
 * Resolves the Cloudflare custom-domain route for an app + mode.
 */
export function resolveCloudflareRoute(appId: AppId, mode: string): string | undefined {
  const cf = APP_CONFIG[appId]?.cloudflare;
  const liveMode = mode as LiveMode;
  return cf?.routes?.[liveMode];
}

/**
 * Resolves the Cloud Run service ID for an app, if configured.
 */
export function resolveCloudRunServiceId(appId: AppId): string | undefined {
  return APP_CONFIG[appId]?.cloudRunServiceId;
}

const BRANCH_MODE_MAP: Record<string, string> = {
  master: 'production',
  main: 'production',
  staging: 'staging',
  dev: 'staging',
} as const;

/**
 * Resolves the deployment mode from a git branch name.
 */
export function resolveMode(branchName: string): string {
  const mode = BRANCH_MODE_MAP[branchName];
  if (!mode) {
    throw new Error(
      `Unknown branch "${branchName}". Expected one of: ${Object.keys(BRANCH_MODE_MAP).join(', ')}`,
    );
  }
  return mode;
}
