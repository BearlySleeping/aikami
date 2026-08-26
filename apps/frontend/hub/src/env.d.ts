// apps/frontend/hub/src/env.d.ts

declare module '$app/env/private' {
  /** Origin base URL for the catalog index (R2 bucket URL). */
  export const CATALOG_ORIGIN_URL: string | undefined;
  /** Base URL for the Better Auth server. */
  export const BETTER_AUTH_URL: string | undefined;
  /** Secret used to sign Better Auth session tokens. */
  export const BETTER_AUTH_SECRET: string | undefined;
  /** Google OAuth client ID for social login. */
  export const GOOGLE_CLIENT_ID: string | undefined;
  /** Google OAuth client secret for social login. */
  export const GOOGLE_CLIENT_SECRET: string | undefined;
  /** Explicit cookie domain for cross-subdomain session sharing. */
  export const BETTER_AUTH_COOKIE_DOMAIN: string | undefined;
  /** OpenRouter API key for the /api/ask endpoint. */
  export const OPENROUTER_API_KEY: string | undefined;
  /** OpenRouter model identifier for the /api/ask endpoint. */
  export const OPENROUTER_MODEL: string | undefined;
}

declare module '$app/env/public' {
  /** Unique app identifier, e.g. "hub". */
  export const PUBLIC_APP_ID: string;
  /** Runtime mode: "emulator" | "staging" | "production". */
  export const PUBLIC_MODE: string;
}
