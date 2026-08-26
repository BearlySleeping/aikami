// apps/frontend/hub/src/env.ts
//
// Explicit environment variable declarations (SvelteKit 3).
// Required vars throw at startup if missing; optional vars have defaults.
// Private vars are server-only (never shipped to the browser).
//
// TypeBox is used for type inference; function validators provide runtime
// validation since TypeBox v1.x does not implement the Standard Schema spec.

/** biome-ignore-all lint/style/useNamingConvention: env variable names are conventionally UPPER_CASE */

import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

// ── Validator helpers

// ── Validator helpers ────────────────────────────────────────────────────

/** Require a non-empty string, fail at runtime if missing (unless building). */
const requiredString =
  (name: string) =>
  (value: string | undefined): string => {
    if (building && !value) {
      return '';
    }
    if (!value || value.trim() === '') {
      throw new Error(`${name} is required but was not set`);
    }
    return value.trim();
  };

/** Optional string with a default fallback. */
const optionalString =
  (defaultValue?: string) =>
  (value: string | undefined): string | undefined =>
    value ?? defaultValue;

// ── Exported variables ───────────────────────────────────────────────────

export const variables = defineEnvVars({
  // ── Private (server-only) ──────────────────────────────────────────────

  /** Origin base URL for the catalog index (R2 bucket URL). */
  CATALOG_ORIGIN_URL: {
    schema: optionalString(),
  },

  /** Base URL for the Better Auth server (e.g. https://hub.bearlysleeping.com). */
  BETTER_AUTH_URL: {
    schema: optionalString(),
  },

  /** Secret used to sign Better Auth session tokens. Required in production. */
  BETTER_AUTH_SECRET: {
    schema: optionalString(),
  },

  /** Google OAuth client ID for social login. */
  GOOGLE_CLIENT_ID: {
    schema: optionalString(),
  },

  /** Google OAuth client secret for social login. */
  GOOGLE_CLIENT_SECRET: {
    schema: optionalString(),
  },

  /** Explicit cookie domain for cross-subdomain session sharing. */
  BETTER_AUTH_COOKIE_DOMAIN: {
    schema: optionalString(),
  },

  /** OpenRouter API key for the /api/ask endpoint. */
  OPENROUTER_API_KEY: {
    schema: optionalString(),
  },

  /** OpenRouter model identifier for the /api/ask endpoint. */
  OPENROUTER_MODEL: {
    schema: optionalString(),
  },

  // ── Public (client-safe) ───────────────────────────────────────────────

  /** Unique app identifier, e.g. "hub". */
  PUBLIC_APP_ID: {
    public: true,
    static: true,
    schema: requiredString('PUBLIC_APP_ID'),
  },

  /** Runtime mode: "emulator" | "staging" | "production". */
  PUBLIC_MODE: {
    public: true,
    static: true,
    schema: requiredString('PUBLIC_MODE'),
  },
});
