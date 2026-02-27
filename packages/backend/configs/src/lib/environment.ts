import process from 'node:process';
import { isEmptyObject, toAppError } from '@aikami/utils';
import { config } from 'dotenv';
import * as env from '$env/static/private';

type OptionalEnvironmentKeys = 'FIREBASE_SERVICE_ACCOUNT' | 'DENO_VERSION';

type RequiredEnvironmentKeys =
  //
  | 'GCP_CLIENT_ID'
  | 'GCP_CLIENT_SECRET'
  | 'GCP_PROJECT_ID'
  | 'FLAVOR'
  | 'PARSE_LEVEL'
  | 'NODE_ENV'
  | 'K_SERVICE'
  // Extra url
  | 'PWA_URL';

// add all keys in ./env.dev to this type
type EnvironmentKey = RequiredEnvironmentKeys | OptionalEnvironmentKeys;

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
  if (!environment) {
    // If env is only { default: [Getter], env: [Getter] } then it means this is not running in sveltekit SSR
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (env && !isEmptyObject(env) && 'FLAVOR' in env) {
      environment = env as EnvironmentData;
    } else if (process.env.FLAVOR) {
      environment = process.env as EnvironmentData;
    } else {
      environment = config().parsed as EnvironmentData;
    }
  }
  environment ??= {};
  const value = environment[environmentKey];
  if (optional) {
    return value as T extends true ? string | undefined : string;
  }

  if (!value) {
    throw toAppError('internal', `process.env.${environmentKey} is missing`);
  }
  return value;
};
