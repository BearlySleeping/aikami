#!/usr/bin/env bun
// scripts/src/lib/ops/d1_migrate_local.ts
//
// C-437: Apply D1 migrations to the local dev database.
//
// Runs `wrangler d1 migrations apply <db-name> --local` from the hub
// directory, targeting the local SQLite state under `.wrangler/`.
//
// Usage:
//   bun run scripts/src/lib/ops/d1_migrate_local.ts
//   bun run db:migrate:local  (from apps/frontend/hub)
//
// C-454: DB_NAME sourced from D1_DATABASES.hub.production (the canonical
// source of truth) instead of a hardcoded literal.

import { resolve } from 'node:path';
import { D1_DATABASES } from '@aikami/constants';
import { error, info, ok } from '../cli_utils.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');
const DB_NAME = D1_DATABASES.hub.production.databaseName;

info(`Applying D1 migrations to local database "${DB_NAME}"...`);
info(`CWD: ${HUB_DIR}`);

const proc = Bun.spawn(['bunx', 'wrangler', 'd1', 'migrations', 'apply', DB_NAME, '--local'], {
  cwd: HUB_DIR,
  stdout: 'inherit',
  stderr: 'inherit',
});

const code = await proc.exited;
if (code !== 0) {
  error(`Migration failed with code ${code}`);
  info('Common issues:');
  info('  • Run from the hub directory or repo root');
  info('  • Missing wrangler — run `bun install`');
  info('  • Corrupt local state — delete .wrangler/ and retry');
  process.exit(code);
}

ok('D1 migrations applied successfully.');
