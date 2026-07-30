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
 *   cloud-run-sveltekit  → Build + Docker + push → Cloud Run (client web)
 *   tauri-release        → Build Tauri desktop app → release artifacts
 *   firebase-hosting     → Build → Firebase Hosting (site, docs)
 *   firebase-functions   → Deploy via firestack (firebase)
 *   docker-release       → Docker build + push only (image, text, voice)
 */

import { MODE_PROJECT_MAP } from '../../../../packages/shared/constants/src/lib/project.ts';
import type { AppId } from '../../../../packages/shared/types/src/index.ts';

export const ALL_SERVICE_TYPES = [
  'cloud-run-sveltekit',
  'tauri-release',
  'firebase-hosting',
  'firebase-functions',
  'docker-release',
] as const;

export type ServiceType = (typeof ALL_SERVICE_TYPES)[number];

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
  /** Cloud Run service ID. Defaults to ${shortName} */
  cloudRunServiceId?: string;
  /** GCP region override. Defaults to the global region variable. */
  region?: string;
  /** Cloud Run CPU allocation (e.g. '1', '2', '4'). Default: not set. */
  cpu?: string;
  /** Cloud Run memory allocation (e.g. '1Gi', '4Gi'). Default: '1Gi'. */
  memory?: string;
  /** VPC connector name for Cloud SQL access. */
  vpcConnector?: string;
  /** Cloud SQL instance connection name. */
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
};

export const APP_CONFIG: Readonly<Record<AppId, AppConfig>> = {
  client: {
    serviceType: 'firebase-hosting',
    path: 'apps/frontend/client',
    shortName: 'client',
    prefix: 'CLIENT',
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
    serviceType: 'firebase-hosting',
    path: 'apps/frontend/site',
    shortName: '',
    prefix: 'SITE',
  },
  docs: {
    serviceType: 'firebase-hosting',
    path: 'apps/frontend/docs',
    shortName: 'docs',
    prefix: 'DOCS',
    enabled: false,
  },
  firebase: {
    serviceType: 'firebase-functions',
    path: 'apps/backend/firebase',
    shortName: 'firebase',
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

/** Modes that deploy to live GCP (not emulator). */
export const liveModes = ['staging', 'production'] as const;
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
 */
export const PROJECT_ENV_CONFIG: Readonly<Record<string, ProjectSecretConfig>> = Object.fromEntries(
  Object.entries(APP_CONFIG).map(([key, config]) => [
    key,
    {
      path: config.path,
      prefix: config.prefix,
      enabled: config.enabled ?? true,
    } satisfies ProjectSecretConfig,
  ]),
);

/**
 * GCP region where Cloud Functions and Cloud Run services are deployed.
 * Must match the `region` field in `apps/backend/firebase/firestack.config.ts`.
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
 * Resolves the Firebase Hosting site ID for an app.
 * Format: {projectId}-{shortName} (globally unique across all Firebase projects).
 */
export function resolveHostingSiteId(appId: AppId, projectId: string): string | undefined {
  const config = APP_CONFIG[appId];
  if (!config) {
    return undefined;
  }
  if (!config.shortName) {
    return projectId;
  }
  return `${projectId}-${config.shortName}`;
}

/**
 * Resolves the Cloud Run service ID for an app.
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
