// packages/backend/database/drizzle.config.ts
//
// C-436: Drizzle Kit config for the Cloudflare D1 schema (sqlite dialect).
// The Postgres config (drizzle.config.ts, pg-core) was removed in C-436.
//
// `drizzle-kit generate` reads the sqlite dialect schema and emits
// timestamped SQL migrations into ./drizzle-d1. Migrations are forward-only
// and generated, never hand-edited; they are applied via
// `wrangler d1 migrations apply DB` (local or remote).

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/schema.ts',
  out: './drizzle-d1',
  // Explicit — never auto-push or pull against a live database.
  strict: true,
  verbose: true,
});
