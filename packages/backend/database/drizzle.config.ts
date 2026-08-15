// packages/backend/database/drizzle.config.ts
//
// C-394: Drizzle Kit config — Drizzle owns DDL (D-9).
//
// `drizzle-kit generate` reads this schema and emits timestamped SQL
// migrations into ./drizzle. Migrations are forward-only and generated,
// never hand-edited; a migration applied to production is immutable.
//
// `drizzle-kit migrate` is NOT the deploy path — applying migrations is an
// explicit step wired through the `database` deploy app (AC-5) so it can use
// the DIRECT endpoint. This config is for generation (and ad-hoc local use).

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/schema.ts',
  out: './drizzle',
  // Explicit — never auto-push or pull against a live database.
  strict: true,
  verbose: true,
});
