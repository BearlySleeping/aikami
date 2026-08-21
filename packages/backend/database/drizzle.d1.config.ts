// packages/backend/database/drizzle.d1.config.ts
//
// C-426 AC-1: Drizzle Kit config for the Cloudflare D1 schema.
//
// `drizzle-kit generate --config drizzle.d1.config.ts` reads the sqlite
// dialect schema (d1_schema.ts) and emits timestamped SQL migrations into
// ./drizzle-d1. Migrations are forward-only and generated, never hand-edited;
// they are applied via `wrangler d1 migrations apply DB` (local or remote).
//
// This is a SEPARATE config from drizzle.config.ts (the Postgres schema),
// which stays live until the decommission phase (AC-8).

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/d1_schema.ts',
  out: './drizzle-d1',
  // Explicit — never auto-push or pull against a live database.
  strict: true,
  verbose: true,
});
