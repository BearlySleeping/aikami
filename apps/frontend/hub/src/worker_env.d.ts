// apps/frontend/hub/src/worker_env.d.ts
//
// Local type shim for the `cloudflare:workers` virtual module.
//
// The real module is provided by the Workers runtime and typed by
// `@cloudflare/workers-types`, but referencing that package globally drags in
// its own `Env`/`Response`/`Request` surface and conflicts with the DOM lib the
// SvelteKit app compiles against. Declaring only the `env` export keeps the
// app's existing DOM types intact while still typing `getWorkerEnv()`.
//
// `Cloudflare.Env` is declared in src/app.d.ts (extending `CloudflareBindings`).

declare module 'cloudflare:workers' {
  const env: Cloudflare.Env;

  export { env };
}
