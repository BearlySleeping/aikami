// biome-ignore-all lint/style/useNamingConvention: mapped type index signature
// packages/backend/configs/src/lib/environment.ts
import process from 'node:process';
import { MODE_PROJECT_MAP } from '@nordclaw/constants';
import { AppIdSchema } from '@nordclaw/schemas';
import type { Mode } from '@nordclaw/types';
import { isEmptyObject, toAppError, toMode } from '@nordclaw/utils';
// We need dotenv for firebase functions
import { config } from 'dotenv';
import { z } from 'zod';
// biome-ignore lint/suspicious/noTsIgnore: See explanation below, pwa gets wrong type error saying $env/static/private is not defined but it is not that deep
// @ts-ignore We need to use this for local debugging of sveltekit apps since it only has access to process.env when you build the app
import * as env from '$env/static/private';

// ── Zod Schema ────────────────────────────────────────────────

/**
 * Zod schema for backend environment variables.
 * All keys are optional by default — the reading layer validates
 * presence at call sites via the type system.
 */
export const BackendEnvSchema = z
  .object({
    // Core app identity — optional in shared schema. Required at call site via
    // requireEnv for standalone backend apps (functions).
    // Optional when backend modules are imported from a SvelteKit SSR context
    // (pwa/admin) where these are unavailable during build.
    APP_ID: AppIdSchema.optional(),
    MODE: z.string().optional(),

    // Required (will throw if missing when accessed without fallback)
    GCP_CLIENT_ID: z.string().optional(),
    GCP_CLIENT_SECRET: z.string().optional(),
    PARSE_LEVEL: z.enum(['off', 'safe', 'on']).optional(),
    NODE_ENV: z.string().optional(),
    K_SERVICE: z.string().optional(),
    PWA_URL: z.string().optional(),

    // Firebase & GCP
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
    FIRESTORE_EMULATOR_HOST: z.string().optional(),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
    GCP_PROJECT_ID: z.string().optional(),

    // Auth
    GMAIL_CLIENT_ID: z.string().optional(),
    GMAIL_CLIENT_SECRET: z.string().optional(),

    // Logging
    LOG_LEVEL: z.string().optional(),
    LOG_PERSIST_LEVEL: z.string().optional(),
    FIRESTACK_FUNCTION_NAME: z.string().optional(),
    GA4_PROPERTY_ID: z.string().optional(),

    // External services — required at call site via requireEnv, optional in shared schema
    // because build contexts may not have these set.
    VM_CONTROLLER_URL: z.string().optional(),
    VM_CONTROLLER_API_KEY: z.string().optional(),
    EMAIL_SERVICE_URL: z.string().optional(),
    EMAIL_SERVICE_API_KEY: z.string().optional(),

    // LLM provider — deepseek | anthropic | stub
    LLM_PROVIDER: z.string().optional(),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().optional(),
    DEEPSEEK_MODEL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),

    // Misc
    VITE_MODE: z.string().optional(),
  })
  .passthrough();

/** Infer the backend env type from the schema. */
export type BackendEnv = z.infer<typeof BackendEnvSchema>;

// ── Multi-source reading ──────────────────────────────────────

// Cache the SvelteKit baked env module so we only unwrap it once.
let svelteKitEnv: Record<string, string | undefined> | undefined;

// Cache dotenv parsed output so we only read .env files once.
let parsedDotEnv: Record<string, string | undefined> | undefined;

/**
 * Reads a single key from the 3 env sources (process.env → SvelteKit → dotenv).
 * Does NOT validate against the Zod schema — returns the raw string.
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

/**
 * Builds the backend env object by reading all schema-known keys
 * from the 3 env sources, then validates them against the Zod schema.
 * Fallback values are used for keys not found in any source.
 */
const buildEnv = (): BackendEnv => {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(BackendEnvSchema.shape)) {
    raw[key] = readRawEnvValue(key);
  }

  const result = BackendEnvSchema.safeParse(raw);

  if (!result.success) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: `Backend env validation failed: ${result.error.issues[0].message}`,
    });
  }

  return Object.freeze(result.data);
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
  if (mode === 'emulator') {
    return true;
  }

  const appMode = getMode();

  return !!backendEnv.FIRESTORE_EMULATOR_HOST || appMode === 'emulator';
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
  // "development" from the base .env file.
  if (isEmulatorMode()) {
    return MODE_PROJECT_MAP.emulator;
  }
  const mode = getMode();
  return (MODE_PROJECT_MAP as Record<string, string>)[mode] ?? MODE_PROJECT_MAP.staging;
};
