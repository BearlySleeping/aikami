// apps/frontend/hub/src/lib/server/worker_env.ts
//
// SvelteKit 3 / @sveltejs/adapter-cloudflare 8 reads Worker bindings from the
// `cloudflare:workers` virtual module instead of passing them to
// `server.respond(..., { platform })`. The generated `_worker.js` therefore
// never populates `event.platform`, so anything that reads `platform.env`
// sees `undefined` in production even though the D1/R2 bindings are deployed.
//
// Routing every binding read through this module is the single point that
// knows about that adapter behaviour:
//   • production / preview (`wrangler dev`) — `cloudflare:workers` exports the
//     live `env` object.
//   • `vite dev` — the adapter's Vite plugin resolves `cloudflare:workers` to
//     a `getPlatformProxy`-backed stub, so `env` still works.
//   • Bun unit tests — `src/lib/test_preload.ts` mocks the module, so tests
//     inject a fake `env` without a Worker runtime.
//
// Bindings live on `Cloudflare.Env`, declared in src/app.d.ts (as the shared
// `CloudflareBindings` interface). That is the shape the adapter's worker entry
// names, so `env` is typed without a cast at the declaration site.

import { env } from 'cloudflare:workers';

/** The hub's Worker bindings, resolved from any runtime. */
export type WorkerEnv = App.Platform['env'];

/**
 * The current request's bindings. Always defined under every supported
 * runtime — the adapter's `cloudflare:workers` shim throws only when a
 * prerenderable route touches it, which the hub has none of.
 */
export const getWorkerEnv = (): WorkerEnv => env;
