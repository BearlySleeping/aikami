// packages/frontend/configs/src/lib/environment.ts
/** biome-ignore-all lint/style/useNamingConvention: env variables should be UPPER_CASE */

import {
  EMULATOR_PORTS as BASE_EMULATOR_PORTS,
  MODE_PROJECT_MAP,
  withPortOffset,
} from '@aikami/constants';
import { FrontendAppIdSchema, LogLevelSchema, ModeSchema } from '@aikami/schemas';
import { toAppError } from '@aikami/utils';
import Type from 'typebox';

// Shifted by PUBLIC_EMULATOR_PORT_OFFSET for contract-scoped pipeline runs
// (set by scripts/src/lib/herdr/session.ts / herdr_adapter.ts) so this app's
// Firebase SDK connects to its own per-contract emulator instance instead of
// colliding with another concurrently-running contract. 0 in normal dev.
const emulatorPortOffset = Number(
  (import.meta.env as unknown as Record<string, string | undefined>).PUBLIC_EMULATOR_PORT_OFFSET ||
    0,
);
export const EMULATOR_PORTS = withPortOffset(BASE_EMULATOR_PORTS, emulatorPortOffset);

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
  PUBLIC_VAPID_KEY: Type.Optional(Type.String()),
  PUBLIC_PARSE_LEVEL: Type.Optional(Type.String()),
  PUBLIC_SITE_URL: Type.Optional(Type.String()),
  PUBLIC_APP_CHECK_DEBUG_TOKEN: Type.Optional(Type.String()),
  PUBLIC_LOG_PERSIST_LEVEL: Type.Optional(Type.String()),
  PUBLIC_VOICE_URL: Type.Optional(Type.String()),
  PUBLIC_QA_BYPASS_TEXT_AI: Type.Optional(Type.String()),
  APP_VERSION: Type.Optional(Type.String()),
});

type MasterEnv = Type.Static<typeof masterSchema>;
type AppID = Type.Static<typeof FrontendAppIdSchema>;

const APP_REQUIREMENTS: Record<AppID, (keyof MasterEnv)[]> = {
  docs: [],
  site: [],
  client: [],
  'client-tauri': [],
  hub: [],
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
    PUBLIC_VAPID_KEY: rawEnv.PUBLIC_VAPID_KEY,
    PUBLIC_PARSE_LEVEL: rawEnv.PUBLIC_PARSE_LEVEL,
    PUBLIC_SITE_URL: rawEnv.PUBLIC_SITE_URL,
    PUBLIC_APP_CHECK_DEBUG_TOKEN: rawEnv.PUBLIC_APP_CHECK_DEBUG_TOKEN,
    PUBLIC_LOG_PERSIST_LEVEL: rawEnv.PUBLIC_LOG_PERSIST_LEVEL,
    PUBLIC_VOICE_URL: rawEnv.PUBLIC_VOICE_URL,
    PUBLIC_QA_BYPASS_TEXT_AI: rawEnv.PUBLIC_QA_BYPASS_TEXT_AI,
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
 * Shared App Check enablement predicate — used by both the client
 * (initializeAppCheckInstance in app_check.ts) and the Hub SSR
 * (hooks.server.ts) so both sides apply identical rules.
 *
 * App Check is enabled only when:
 * - PUBLIC_DISABLE_APP_CHECK is not set to '1' or 'true'
 * - a real reCAPTCHA site key is configured
 * - the mode is production (non-production modes disable App Check on
 *   the client because no debug token is registered — the server must
 *   not demand tokens the client cannot produce)
 */
export const isAppCheckEnabled = (): boolean => {
  const { PUBLIC_DISABLE_APP_CHECK: disableAppCheck, PUBLIC_RECAPTCHA_SITE_KEY: recaptchaSiteKey } =
    publicEnv;
  const isDisabled = disableAppCheck === '1' || disableAppCheck === 'true';
  const mode = getPublicMode();
  const isNonProductionMode = mode && mode !== 'production';
  return !isDisabled && !!recaptchaSiteKey && !isNonProductionMode;
};

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
