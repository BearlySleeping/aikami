// Stub for SvelteKit's $env/static/private module.
// This module is provided by SvelteKit at build time in the PWA context.
// In non-SvelteKit contexts (e.g., Cloud Functions), the environment.ts
// fallback to process.env or dotenv handles environment resolution.
declare module '$env/static/private' {
  const env: Record<string, string | undefined>;
  export = env;
}
