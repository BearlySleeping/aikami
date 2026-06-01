// scripts/deployment-config.ts
/**
 * Global deployment configuration for the monorepo.
 *
 * Single source of truth for:
 * - App deployment metadata (service types, paths, names, regions, site IDs)
 * - Secret management configuration (prefixes, mode mappings)
 *
 * Imports project IDs from shared constants (relative path, no alias)
 * to keep a single source of truth across all apps.
 */
// We use relative import and not alias since
// .pi/extensions/log-viewer.ts
// uses this file as a one source of truth, and .pi does not support alias
import { MODE_PROJECT_MAP } from '../../../../packages/shared/constants/src/lib/project.ts';
import type { AppId } from '../../../../packages/shared/types/src/index.ts';

export const ALL_SERVICE_TYPES = [
  'cloud-run-sveltekit',
  'cloud-run-api',
  'firebase-hosting',
  'firebase-backend',
] as const;

export type ServiceType = (typeof ALL_SERVICE_TYPES)[number];

export type AppConfig = {
  serviceType: ServiceType;
  /** Relative path from repo root */
  path: string;
  /** Short identifier used in docker tags, URLs, etc. */
  shortName: string;
  /** Env var prefix for app-specific secrets in GCP Secret Manager */
  prefix?: string;
  /** Branches that are allowed to deploy this app. If omitted, all branches. */
  deployBranches?: string[];
  /** Cloud Run service ID. Defaults to ${shortName} */
  cloudRunServiceId?: string;
  /** GCP region override. Defaults to the global region variable. */
  region?: string;
  /** Cloud Run CPU allocation (e.g. '1', '2', '4'). Default: not set (Cloud Run default). */
  cpu?: string;
  /** Cloud Run memory allocation (e.g. '1Gi', '4Gi'). Default: '1Gi'. */
  memory?: string;
};

export const APP_CONFIG: Readonly<Record<AppId, AppConfig>> = {
  pwa: {
    serviceType: 'cloud-run-sveltekit',
    path: 'apps/frontend/pwa',
    shortName: 'pwa',
    prefix: 'PWA',
    cloudRunServiceId: 'pwa',
  },
  // biome-ignore lint/style/useNamingConvention: config key matching directory name
  landing_page: {
    serviceType: 'firebase-hosting',
    path: 'apps/frontend/landing',
    shortName: 'info',
    prefix: 'LANDING',
    deployBranches: ['master', 'dev'],
  },
  firebase: {
    serviceType: 'firebase-backend',
    path: 'apps/backend/firebase',
    shortName: 'firebase',
  },
  docs: {
    serviceType: 'firebase-hosting',
    path: 'apps/frontend/docs',
    shortName: 'docs',
    prefix: 'Docs',
    deployBranches: ['master', 'dev'],
  },
  game: {
    serviceType: 'cloud-run-sveltekit',
    path: 'apps/frontend/game',
    shortName: 'game',
    prefix: 'Game',
    cloudRunServiceId: 'game',
  },
};

export const DEPLOYABLE_APPS = Object.keys(APP_CONFIG);

// ---------------------------------------------------------------------------
// Secret Management
// ---------------------------------------------------------------------------

export const APP_SPECIFIC_KEYS_FOR_PREFIX = new Set([
  'PUBLIC_FIREBASE_APP_ID',
  'PUBLIC_FIREBASE_MEASUREMENT_ID',
  'PUBLIC_RECAPTCHA_SITE_KEY',
  'PUBLIC_APP_CHECK_DEBUG_TOKEN',
  'PUBLIC_LOG_LEVEL',
  'PUBLIC_LOG_PERSIST_LEVEL',
  'LOG_PERSIST_LEVEL',
  'RECAPTCHA_SECRET_KEY',
  'API_KEY',
]);

/** Re-exported from shared constants for convenience. */
export { MODE_PROJECT_MAP };

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
      enabled: true,
    } satisfies ProjectSecretConfig,
  ]),
);

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
} as const;

/**
 * Resolves the deployment mode from a git branch name.
 * Throws if the branch is not mapped to a known mode.
 */
export function resolveMode(branchName: string): string {
  const mode = BRANCH_MODE_MAP[branchName];
  if (!mode) {
    throw new Error(
      `Unknown branch "${branchName}". Expected one of: ${Object.keys(BRANCH_MODE_MAP).join(', ')} (maps to development, production, or emulator)`,
    );
  }
  return mode;
}
