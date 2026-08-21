// apps/frontend/hub/cloudflare-stubs/turso.js
// Stub for native-only modules (@tursodatabase/database, @libsql/client, pg)
// that cannot run on a Cloudflare Worker.
//
// These are dynamically imported by desktop/game-engine code paths
// (frontend-storage / frontend-engine) that the hub dashboard never executes
// on the server. Wrangler's bundler needs the import to resolve, so we alias
// these native modules to this stub. If a code path ever calls them at
// runtime on the Worker, it gets a clear "unsupported on Cloudflare" error
// instead of a silent failure.

export function connect() {
  throw new Error(
    '@tursodatabase/database is not available on Cloudflare Workers (native Rust module).',
  );
}

export const libsql = { connect };
export default { connect };
