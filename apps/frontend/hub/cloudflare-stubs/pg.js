// apps/frontend/hub/cloudflare-stubs/pg.js
// Stub for the `pg` (node-postgres) module, which needs raw node:net sockets
// that are not available on a plain Cloudflare Worker (no Hyperdrive binding
// wired yet — see scripts/src/lib/deploy/cloudflare.ts).
//
// The hub's data plane (packages/backend/database) creates its pool lazily and
// never connects unless a query runs, so this stub is only hit if a route
// actually tries to query Postgres. When that happens it throws a clear error.

export class Pool {
  constructor() {
    throw new Error(
      'pg is not available on this Cloudflare Worker — no Hyperdrive binding configured yet.',
    );
  }
}

export const Client = Pool;
// biome-ignore lint/style/useNamingConvention: `Client` must match the `pg` module's public API surface.
export default { Pool, Client };
