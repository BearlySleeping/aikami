// packages/backend/configs/src/lib/environment.ts
import process from 'node:process';
import { MODE_PROJECT_MAP } from '@aikami/constants';
import type { Mode } from '@aikami/types';
import { isEmptyObject, toAppError, toMode } from '@aikami/utils';
// We need dotenv for firebase functions
import { config } from 'dotenv';
// biome-ignore lint/suspicious/noTsIgnore: See explanation below, client gets wrong type error saying $env/static/private is not defined but it is not that deep
// @ts-ignore We need to use this for local debugging of sveltekit apps since it only has access to process.env when you build the app
import * as env from '$env/static/private';

// ── Env Type ──────────────────────────────────────────────────

/**
 * Backend environment variables type.
 * All keys are optional by default — the reading layer validates
 * presence at call sites via the type system.
 */
export type BackendEnv = {
  readonly APP_ID?: string;
  readonly MODE?: string;
  readonly GCP_CLIENT_ID?: string;
  readonly GCP_CLIENT_SECRET?: string;
  readonly PARSE_LEVEL?: 'off' | 'safe' | 'on';
  readonly NODE_ENV?: string;
  readonly K_SERVICE?: string;
  readonly PWA_URL?: string;
  readonly FIREBASE_SERVICE_ACCOUNT?: string;
  readonly FIRESTORE_EMULATOR_HOST?: string;
  readonly FIREBASE_AUTH_EMULATOR_HOST?: string;
  readonly GCP_PROJECT_ID?: string;
  readonly GMAIL_CLIENT_ID?: string;
  readonly GMAIL_CLIENT_SECRET?: string;
  readonly LOG_LEVEL?: string;
  readonly LOG_PERSIST_LEVEL?: string;
  readonly FIRESTACK_FUNCTION_NAME?: string;
  readonly GA4_PROPERTY_ID?: string;
  readonly VM_CONTROLLER_URL?: string;
  readonly VM_CONTROLLER_API_KEY?: string;
  readonly EMAIL_SERVICE_URL?: string;
  readonly EMAIL_SERVICE_API_KEY?: string;
  readonly LLM_PROVIDER?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_BASE_URL?: string;
  readonly DEEPSEEK_MODEL?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly VITE_MODE?: string;
};

// ── Multi-source reading ──────────────────────────────────────

// Cache the SvelteKit baked env module so we only unwrap it once.
let svelteKitEnv: Record<string, string | undefined> | undefined;

// Cache dotenv parsed output so we only read .env files once.
let parsedDotEnv: Record<string, string | undefined> | undefined;

/**
 * Reads a single key from the 3 env sources (process.env → SvelteKit → dotenv).
 * Does NOT validate against the TypeBox schema — returns the raw string.
 */
const readRawEnvValue = (key: string): string | undefined => {
  // 1. process.env — runtime (always checked, fastest)
  if (key in process.env) {
    const value = process.env[key];
    if (value !== undefined) {
      return value;
    }
  }

  // 2. SvelteKit baked env module — only available inside SSR
  if (!svelteKitEnv) {
    try {
      const maybeEnv = env as Record<string, string | undefined> | undefined;
      if (maybeEnv && !isEmptyObject(maybeEnv) && 'MODE' in maybeEnv) {
        svelteKitEnv = maybeEnv;
      } else {
        svelteKitEnv = {};
      }
    } catch {
      svelteKitEnv = {};
    }
  }
  if (key in svelteKitEnv) {
    const value = svelteKitEnv[key];
    if (value !== undefined) {
      return value;
    }
  }

  // 3. dotenv — .env file in CWD (local scripts, Firebase Functions)
  if (!parsedDotEnv) {
    try {
      parsedDotEnv = (config().parsed ?? {}) as Record<string, string | undefined>;
    } catch {
      parsedDotEnv = {};
    }
  }
  if (key in parsedDotEnv) {
    const value = parsedDotEnv[key];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

// ── Lazy singleton ───────────────────────────────────────────

let _backendEnv: BackendEnv | undefined;

const BACKEND_ENV_KEYS: (keyof BackendEnv)[] = [
  'APP_ID',
  'MODE',
  'GCP_CLIENT_ID',
  'GCP_CLIENT_SECRET',
  'PARSE_LEVEL',
  'NODE_ENV',
  'K_SERVICE',
  'PWA_URL',
  'FIREBASE_SERVICE_ACCOUNT',
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'GCP_PROJECT_ID',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'LOG_LEVEL',
  'LOG_PERSIST_LEVEL',
  'FIRESTACK_FUNCTION_NAME',
  'GA4_PROPERTY_ID',
  'VM_CONTROLLER_URL',
  'VM_CONTROLLER_API_KEY',
  'EMAIL_SERVICE_URL',
  'EMAIL_SERVICE_API_KEY',
  'LLM_PROVIDER',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'ANTHROPIC_API_KEY',
  'VITE_MODE',
];

/**
 * Builds the backend env object by reading all known keys
 * from the 3 env sources.
 */
const buildEnv = (): BackendEnv => {
  const raw: BackendEnv = {};
  for (const key of BACKEND_ENV_KEYS) {
    const value = readRawEnvValue(key);
    if (value !== undefined) {
      (raw as Record<string, string | undefined>)[key] = value;
    }
  }

  return Object.freeze(raw);
};

/**
 * Lazy-initialized, validated backend environment singleton.
 * All known keys are typed — optional keys may be undefined.
 * For required keys use `requireEnv(backendEnv.KEY, 'KEY')` to
 * throw with a descriptive error message if missing.
 */
export const backendEnv: BackendEnv = new Proxy<Record<string, unknown>>(
  {},
  {
    get(_target, prop: string | symbol) {
      if (!_backendEnv) {
        _backendEnv = buildEnv();
      }
      return Reflect.get(_backendEnv, prop);
    },
    has(_target, prop: string | symbol) {
      if (!_backendEnv) {
        _backendEnv = buildEnv();
      }
      return Reflect.has(_backendEnv, prop);
    },
    ownKeys() {
      if (!_backendEnv) {
        _backendEnv = buildEnv();
      }
      return Reflect.ownKeys(_backendEnv);
    },
    getOwnPropertyDescriptor(_target, prop: string | symbol) {
      if (!_backendEnv) {
        _backendEnv = buildEnv();
      }
      return Reflect.getOwnPropertyDescriptor(_backendEnv, prop);
    },
  },
) as BackendEnv;

// ── Helpers ─────────────────────────────────────────────────

/**
 * Assert that a required env var is defined. Throws with a clear message
 * if the value is undefined (matching the old `getBackendEnvironmentValue`
 * behavior without `optional=true`).
 *
 * @example
 *   const url = requireEnv(backendEnv.VM_CONTROLLER_URL, 'VM_CONTROLLER_URL');
 */
export const requireEnv = (value: string | undefined, name: string): string => {
  if (value === undefined) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: `Environment variable ${name} is missing.`,
    });
  }
  return value;
};

/**
 * Returns the mode of the application, normalized to lowercase.
 */
export const getMode = (): Mode => {
  return toMode(backendEnv.MODE);
};

/**
 * Determines if the application is currently running in emulator mode.
 */
export const isEmulatorMode = (): boolean => {
  const mode = backendEnv.VITE_MODE ?? backendEnv.NODE_ENV ?? '';
  if (mode === 'emulator' || mode === 'testing') {
    return true;
  }

  const appMode = getMode();

  return !!backendEnv.FIRESTORE_EMULATOR_HOST || appMode === 'emulator' || appMode === 'testing';
};

/**
 * @returns true if currently running on Cloud Run
 */
export const isRunningOnCloudRun = (): boolean => {
  return !!process.env.K_SERVICE;
};

/**
 * The Firebase/GCP project ID for the current mode.
 * Derived from MODE_PROJECT_MAP — no need for a GCLOUD_PROJECT env var.
 */
export const getProjectId = (): string => {
  // When running in emulator mode, always use the emulator project ID
  // regardless of what getMode() reports. This handles the case where
  // FIRESTORE_EMULATOR_HOST is set but MODE env var still reads as
  // "staging" from the base .env file.
  if (isEmulatorMode()) {
    return MODE_PROJECT_MAP.emulator;
  }
  const mode = getMode();
  return (MODE_PROJECT_MAP as Record<string, string>)[mode] ?? MODE_PROJECT_MAP.staging;
};
