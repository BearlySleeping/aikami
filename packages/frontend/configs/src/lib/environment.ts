// packages/frontend/configs/src/lib/environment.ts
import { LogLevelPriority } from '@aikami/constants';
import { z } from 'zod';
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';

/**
 * Master environment schema for client-side env vars.
 * Uses SvelteKit's PUBLIC_ prefix for client-accessible variables.
 */
const masterSchema = z.object({
  PUBLIC_FLAVOR: z.enum(['development', 'staging', 'production', 'emulator']).default('development'),
  PUBLIC_FIREBASE_PROJECT_ID: z.string(),
  PUBLIC_FIREBASE_API_KEY: z.string().optional(),
  PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  PUBLIC_FIREBASE_APP_ID: z.string().optional(),
  PUBLIC_FIREBASE_MEASUREMENT_ID: z.string().optional(),
  PUBLIC_LOG_LEVEL: z
    .enum(Object.keys(LogLevelPriority) as [string, ...string[]])
    .default('INFO'),
  PUBLIC_DISABLE_APP_CHECK: z.string().optional(),
  PUBLIC_RECAPTCHA_SITE_KEY: z.string().optional(),
  PUBLIC_GMAIL_CLIENT_ID: z.string().optional(),
  PUBLIC_VAPID_KEY: z.string().optional(),
  PUBLIC_SITE_URL: z.string().optional(),
});

type MasterEnv = z.infer<typeof masterSchema>;

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
    logger.error('Env validation failed:', result.error.format());
    throw toAppError({
      errorType: 'internal',
      errorMessage: `Env validation failed: ${result.error.issues[0].message}`,
    });
  }

  return Object.freeze(result.data);
};

export const publicEnv = validateEnv();

export const isEmulatorMode = () => publicEnv.PUBLIC_FLAVOR === 'emulator';
export const isDevelopmentMode = () => publicEnv.PUBLIC_FLAVOR !== 'production';
export const getFlavor = () => publicEnv.PUBLIC_FLAVOR;
