// packages/frontend/configs/src/lib/environment.ts
/** biome-ignore-all lint/style/useNamingConvention: env variables should be UPPER_CASE */

import { MODE_PROJECT_MAP } from '@aikami/constants';
import { FrontendAppIdSchema, LogLevelSchema, ModeSchema } from '@aikami/schemas';
import { toAppError } from '@aikami/utils';
import Type from 'typebox';

export { EMULATOR_PORTS } from '@aikami/constants';

/**
 * 1. MASTER SCHEMA (TypeBox — used for type inference only)
 */
const masterSchema = Type.Object({
  PUBLIC_APP_ID: FrontendAppIdSchema,
  PUBLIC_MODE: ModeSchema,
  PUBLIC_LOG_LEVEL: LogLevelSchema,
  PUBLIC_FIREBASE_API_KEY: Type.String(),
  PUBLIC_FIREBASE_AUTH_DOMAIN: Type.String(),
  PUBLIC_FIREBASE_STORAGE_BUCKET: Type.String(),
  PUBLIC_FIREBASE_APP_ID: Type.String(),
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID: Type.String(),
  PUBLIC_FIREBASE_MEASUREMENT_ID: Type.String(),
  PUBLIC_DISABLE_APP_CHECK: Type.Optional(Type.String()),
  PUBLIC_RECAPTCHA_SITE_KEY: Type.Optional(Type.String()),
  PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE: Type.Optional(Type.String()),
  PUBLIC_GMAIL_CLIENT_ID: Type.Optional(Type.String()),
  PUBLIC_EDGE_PROXY_URL: Type.Optional(Type.String()),
  PUBLIC_DEFAULT_COMPANY_ID: Type.Optional(Type.String()),
  PUBLIC_VAPID_KEY: Type.Optional(Type.String()),
  PUBLIC_PARSE_LEVEL: Type.Optional(Type.String()),
  PUBLIC_SITE_URL: Type.Optional(Type.String()),
  PUBLIC_APP_CHECK_DEBUG_TOKEN: Type.Optional(Type.String()),
  PUBLIC_LOG_PERSIST_LEVEL: Type.Optional(Type.String()),
  PUBLIC_PWA_URL: Type.Optional(Type.String()),
  PUBLIC_VOICE_URL: Type.Optional(Type.String()),
  APP_VERSION: Type.Optional(Type.String()),
});

type MasterEnv = Type.Static<typeof masterSchema>;
type AppID = Type.Static<typeof FrontendAppIdSchema>;

const APP_REQUIREMENTS: Record<AppID, (keyof MasterEnv)[]> = {
  docs: [],
  site: [],
  client: [],
};

/**
 * 2. THE VALIDATOR
 * Basic runtime check — TypeBox schemas define the shape but don't provide
 * built-in validation in v1.x. We validate presence of required fields manually.
 */
const validateEnv = (): MasterEnv => {
  const rawEnv = import.meta.env as unknown as Record<string, string | undefined>;

  if (!rawEnv) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Environment source (import.meta.env) is unavailable.',
    });
  }

  // Basic check: ensure PUBLIC_APP_ID and PUBLIC_MODE are present
  if (!rawEnv.PUBLIC_APP_ID || !rawEnv.PUBLIC_MODE) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'PUBLIC_APP_ID and PUBLIC_MODE are required.',
    });
  }

  if (!rawEnv.PUBLIC_FIREBASE_API_KEY) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'PUBLIC_FIREBASE_API_KEY is required.',
    });
  }

  // Build typed env from source (cast raw string values to schema types)
  const env: MasterEnv = {
    PUBLIC_APP_ID: rawEnv.PUBLIC_APP_ID as MasterEnv['PUBLIC_APP_ID'],
    PUBLIC_MODE: rawEnv.PUBLIC_MODE as MasterEnv['PUBLIC_MODE'],
    PUBLIC_LOG_LEVEL: (rawEnv.PUBLIC_LOG_LEVEL ?? 'INFO') as MasterEnv['PUBLIC_LOG_LEVEL'],
    PUBLIC_FIREBASE_API_KEY: rawEnv.PUBLIC_FIREBASE_API_KEY as string,
    PUBLIC_FIREBASE_AUTH_DOMAIN: rawEnv.PUBLIC_FIREBASE_AUTH_DOMAIN as string,
    PUBLIC_FIREBASE_STORAGE_BUCKET: rawEnv.PUBLIC_FIREBASE_STORAGE_BUCKET as string,
    PUBLIC_FIREBASE_APP_ID: rawEnv.PUBLIC_FIREBASE_APP_ID as string,
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID: rawEnv.PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string,
    PUBLIC_FIREBASE_MEASUREMENT_ID: rawEnv.PUBLIC_FIREBASE_MEASUREMENT_ID as string,
    PUBLIC_DISABLE_APP_CHECK: rawEnv.PUBLIC_DISABLE_APP_CHECK,
    PUBLIC_RECAPTCHA_SITE_KEY: rawEnv.PUBLIC_RECAPTCHA_SITE_KEY,
    PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE: rawEnv.PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE,
    PUBLIC_GMAIL_CLIENT_ID: rawEnv.PUBLIC_GMAIL_CLIENT_ID,
    PUBLIC_EDGE_PROXY_URL: rawEnv.PUBLIC_EDGE_PROXY_URL,
    PUBLIC_DEFAULT_COMPANY_ID: rawEnv.PUBLIC_DEFAULT_COMPANY_ID,
    PUBLIC_VAPID_KEY: rawEnv.PUBLIC_VAPID_KEY,
    PUBLIC_PARSE_LEVEL: rawEnv.PUBLIC_PARSE_LEVEL,
    PUBLIC_SITE_URL: rawEnv.PUBLIC_SITE_URL,
    PUBLIC_APP_CHECK_DEBUG_TOKEN: rawEnv.PUBLIC_APP_CHECK_DEBUG_TOKEN,
    PUBLIC_LOG_PERSIST_LEVEL: rawEnv.PUBLIC_LOG_PERSIST_LEVEL,
    PUBLIC_PWA_URL: rawEnv.PUBLIC_PWA_URL,
    PUBLIC_VOICE_URL: rawEnv.PUBLIC_VOICE_URL,
  };

  const appId = env.PUBLIC_APP_ID as AppID;
  const requirements = APP_REQUIREMENTS[appId];
  if (!requirements) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: `Unknown app ID "${appId}". Valid values: ${Object.keys(APP_REQUIREMENTS).join(', ')}.`,
    });
  }
  const missing = requirements.filter((key) => !rawEnv[key]);

  if (missing.length > 0) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: `[${appId.toUpperCase()}] Missing variables: ${missing.join(', ')}`,
    });
  }

  return Object.freeze(env as MasterEnv);
};

/**
 * 3. EXPORTED SINGLETON
 */
export const publicEnv = validateEnv();

export const isEmulatorModePublic = () =>
  publicEnv.PUBLIC_MODE === 'emulator' || publicEnv.PUBLIC_MODE === 'testing';
export const isDevelopmentModePublic = () => publicEnv.PUBLIC_MODE !== 'production';
export const getPublicMode = () => publicEnv.PUBLIC_MODE;

/**
 * The Firebase/GCP project ID for the current mode.
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
      `Expected one of: [${validModes}]`,
  });
};
