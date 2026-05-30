// packages/frontend/configs/src/lib/environment.ts
/** biome-ignore-all lint/style/useNamingConvention: env variables should be UPPER_CASE */

import { MODE_PROJECT_MAP } from '@aikami/constants';
import { FrontendAppIdSchema, LogLevelSchema, ModeSchema } from '@aikami/schemas';
import { toAppError } from '@aikami/utils';
import { z } from 'zod';
import { logger } from '$logger';

export { EMULATOR_PORTS } from '@aikami/constants';

/**
 * 1. MASTER SCHEMA
 * Note: SvelteKit requires 'VITE_' or 'PUBLIC_' prefixes for client-side access.
 * We'll stick to 'PUBLIC_' as per your convention.
 */
const masterSchema = z.object({
  PUBLIC_APP_ID: FrontendAppIdSchema,
  // Core Configuration — validated against shared mode schemas
  PUBLIC_MODE: ModeSchema,

  // Log level validation using the shared LogLevelSchema
  PUBLIC_LOG_LEVEL: LogLevelSchema.default('INFO'),

  // Firebase client SDK config — set via .env files for all modes.
  PUBLIC_FIREBASE_API_KEY: z.string(),
  PUBLIC_FIREBASE_AUTH_DOMAIN: z.string(),
  PUBLIC_FIREBASE_STORAGE_BUCKET: z.string(),
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string(),
  PUBLIC_FIREBASE_APP_ID: z.string(),
  PUBLIC_FIREBASE_MEASUREMENT_ID: z.string(),
  PUBLIC_DISABLE_APP_CHECK: z.string().optional(),
  PUBLIC_RECAPTCHA_SITE_KEY: z.string().optional(),
  PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE: z.string().optional(),

  // Feature flags & client config
  PUBLIC_GMAIL_CLIENT_ID: z.string().optional(),
  PUBLIC_EDGE_PROXY_URL: z.string().optional(),
  PUBLIC_DEFAULT_COMPANY_ID: z.string().optional(),
  PUBLIC_VAPID_KEY: z.string().optional(),
  PUBLIC_PARSE_LEVEL: z.string().optional(),
  PUBLIC_SITE_URL: z.string().optional(),
  PUBLIC_APP_CHECK_DEBUG_TOKEN: z.string().optional(),
  PUBLIC_LOG_PERSIST_LEVEL: z.string().optional(),
});

type MasterEnv = z.infer<typeof masterSchema>;
type AppID = z.infer<typeof FrontendAppIdSchema>;

const APP_REQUIREMENTS: Record<AppID, (keyof MasterEnv)[]> = {
  docs: [],
  gamejs: [],
  landing_page: [],
  pwa: [],
};

/**
 * 2. THE VALIDATOR
 * We add a check for 'import.meta.env' existence to prevent
 * early-load crashes in weird test environments.
 */
const validateEnv = (): MasterEnv => {
  const envSource = import.meta.env;

  if (!envSource) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Environment source (import.meta.env) is unavailable.',
    });
  }

  const result = masterSchema.safeParse(envSource);

  if (!result.success) {
    // We log to console here because SSR errors can sometimes be swallowed
    logger.error('❌ Env Validation Failed:', result.error.format());

    throw toAppError({
      errorType: 'internal',
      errorMessage: `Env Validation Failed: ${result.error.issues[0].message}`,
    });
  }

  const env = result.data;
  const appId = env.PUBLIC_APP_ID;

  // Enforce specific app requirements
  const missing = APP_REQUIREMENTS[appId].filter((key) => !envSource[key]);

  if (missing.length > 0) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: `[${appId.toUpperCase()}] Missing variables: ${missing.join(', ')}`,
    });
  }

  return Object.freeze(env);
};

/**
 * 3. EXPORTED SINGLETON
 * Because SvelteKit runs this file on both Server and Client,
 * this validation will run on your Node/Edge runtime AND your Browser.
 */
export const publicEnv = validateEnv();

/** * Helpers that reference the singleton
 */
export const isEmulatorModePublic = () => publicEnv.PUBLIC_MODE === 'emulator';
export const isDevelopmentModePublic = () => publicEnv.PUBLIC_MODE !== 'production';
export const getPublicMode = () => publicEnv.PUBLIC_MODE;

/**
 * The Firebase/GCP project ID for the current mode.
 * Derived from MODE_PROJECT_MAP — no need for a PUBLIC_FIREBASE_PROJECT_ID env var.
 */
export const getProjectId = (): string => {
  const currentMode = publicEnv?.PUBLIC_MODE;
  const projectId = (MODE_PROJECT_MAP as Record<string, string>)[currentMode];

  if (projectId) {
    return projectId;
  }

  const validModes = Object.keys(MODE_PROJECT_MAP)
    .map((m) => `"${m}"`)
    .join(', ');

  throw toAppError({
    errorType: 'internal',
    errorMessage:
      `[Configuration Error]: Missing or invalid project ID mapping for mode: "${currentMode}".\n\n` +
      `👉 HOW TO FIX THIS:\n` +
      `1. Ensure you have created the correct environment file (e.g., .env.${currentMode || 'local'} or .env.production).\n` +
      `2. Verify that 'PUBLIC_MODE' is explicitly defined in that file.\n` +
      `3. 'PUBLIC_MODE' must exactly match one of the keys in MODE_PROJECT_MAP.\n\n` +
      `Current received value: ${currentMode ? `"${currentMode}"` : 'undefined'}\n` +
      `Expected one of: [${validModes}]`,
  });
};
