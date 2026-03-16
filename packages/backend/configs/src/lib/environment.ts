// packages/backend/configs/src/lib/environment.ts
import process from 'node:process';
import { isEmptyObject, toAppError } from '@aikami/utils';
import { config } from 'dotenv';
import * as env from '$env/static/private';

type OptionalEnvironmentKeys =
  | 'FIREBASE_SERVICE_ACCOUNT'
  | 'FIRESTORE_EMULATOR_HOST'
  | 'VITE_MODE'
  | 'FIREBASE_AUTH_EMULATOR_HOST'
  | 'GCP_PROJECT_ID'
  | 'PUBLIC_FLAVOR';

type RequiredEnvironmentKeys =
  //
  | 'GCP_CLIENT_ID'
  | 'GCP_CLIENT_SECRET'
  | 'FLAVOR'
  | 'PARSE_LEVEL'
  | 'NODE_ENV'
  | 'K_SERVICE'
  // Extra url
  | 'PWA_URL';

// GCLOUD_PROJECT is conditionally required - needed in production but has default for emulator
type ConditionalEnvironmentKeys = 'GCLOUD_PROJECT';

type EnvironmentKey =
  | RequiredEnvironmentKeys
  | OptionalEnvironmentKeys
  | ConditionalEnvironmentKeys;

type EnvironmentData = {
  [key in EnvironmentKey]?: string;
};

let environment: EnvironmentData | undefined;

/**
 * Get the environment value for the given key
 *
 * @param environmentKey the key to get the value for
 * @param optional if the key is optional. If it is optional and the value is
 *   not set, undefined will be returned instead of throwing an error
 * @returns the value for the given key
 */
export const getEnvironmentValue = <T extends boolean = false>(
  environmentKey: EnvironmentKey,
  optional: T = false as T,
): T extends true ? string | undefined : string => {
  // 1. Always check process.env first! This catches emulator variables.
  let value = process.env[environmentKey];

  if (!value) {
    if (!environment) {
      const parsedDotEnv = config().parsed || {};
      const svelteEnv = env && !isEmptyObject(env) && 'FLAVOR' in env ? env : {};

      environment = {
        ...parsedDotEnv,
        ...svelteEnv,
      } as EnvironmentData;
    }
    value = environment[environmentKey];
  }

  // For GCLOUD_PROJECT, provide default in emulator mode
  if (!value && environmentKey === 'GCLOUD_PROJECT') {
    const mode = getEnvironmentValue('VITE_MODE', true) || getEnvironmentValue('NODE_ENV', true);
    const flavor = environment?.FLAVOR || process.env.FLAVOR;
    if (mode === 'emulator' || flavor === 'EMULATOR') {
      value = 'aikami-dev';
    }
  }

  if (optional) {
    return value as T extends true ? string | undefined : string;
  }

  if (!value) {
    throw toAppError('internal', `Environment variable ${environmentKey} is missing.`);
  }

  return value;
};

/**
 * Determines if the application is currently running in emulator mode.
 * Checks multiple sources: process.env, and vite mode.
 */
export const isEmulatorMode = (): boolean => {
  // Check vite mode (set via --mode flag or vite.config.ts)
  const mode = getEnvironmentValue('VITE_MODE', true) || getEnvironmentValue('NODE_ENV', true);
  if (mode === 'emulator') {
    return true;
  }

  // Check FLAVOR (private) or PUBLIC_FLAVOR (public)
  const flavor = getEnvironmentValue('FLAVOR', true) || getEnvironmentValue('PUBLIC_FLAVOR', true);

  return !!getEnvironmentValue('FIRESTORE_EMULATOR_HOST', true) || flavor === 'EMULATOR';
};
