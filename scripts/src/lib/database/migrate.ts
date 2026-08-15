// scripts/src/lib/database/migrate.ts
//
// C-394: developer-facing migration command for the server data plane.
//
//   bun run db:migrate               → apply pending migrations to LOCAL postgres
//   bun run db:migrate --mode=production  → apply pending migrations to Neon
//                                          (NEON_DATABASE_URL_DIRECT from the hub's
//                                          .env.production — the DIRECT endpoint;
//                                          DDL under the pooled endpoint breaks)
//   bun run db:status                → print how many migrations are applied
//
// The hub's `dev` script runs with --mode emulator, so the emulator URL below
// is the local C-387 PostgreSQL — one value serves both NEON_DATABASE_URL and
// NEON_DATABASE_URL_DIRECT there.
//
// 🔴 This is the DEVELOPER command. The production DEPLOY path is the
// `database` app in scripts/src/lib/deploy/index.ts (AC-5), which runs the
// same applyMigrations against NEON_DATABASE_URL_DIRECT as an explicit deploy
// step — never as a side effect of deploying the hub.

import { resolve } from 'node:path';
import {
  applyMigrations,
  countAppliedMigrations,
} from '../../../../packages/backend/database/src/index.ts';
import { parseEnvKeys } from '../deploy/utils.ts';

const HUB_ENV_DIR = resolve(import.meta.dir, '../../../../apps/frontend/hub');

/** Local C-387 PostgreSQL — no pooler, so one URL serves both roles. */
const LOCAL_CONNECTION_URL = 'postgresql://localhost:5433/aikami_dev?sslmode=disable';

/**
 * Resolve the DIRECT migration connection string for a mode.
 * - emulator → local postgres
 * - production → NEON_DATABASE_URL_DIRECT from the hub's .env.production
 * Anything else (staging is on hold, D-10) is an explicit error.
 */
const resolveDirectUrl = (mode: string): string => {
  if (mode === 'emulator') {
    return LOCAL_CONNECTION_URL;
  }
  if (mode === 'production') {
    const vars = parseEnvKeys(resolve(HUB_ENV_DIR, '.env.production'));
    const direct = vars.NEON_DATABASE_URL_DIRECT;
    if (!direct) {
      throw new Error(
        'NEON_DATABASE_URL_DIRECT is not set in apps/frontend/hub/.env.production — ' +
          'migrations must run through the DIRECT (unpooled) endpoint.',
      );
    }
    return direct;
  }
  throw new Error(
    `Unsupported mode "${mode}" for db:migrate. Staging is not configured (D-10) — ` +
      'use emulator (local postgres) or production (Neon).',
  );
};

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(2);
  const modeFlag = args.find((arg) => arg.startsWith('--mode='));
  const mode = modeFlag?.split('=')[1] ?? 'emulator';
  const isStatus = args.includes('--status');

  const connectionString = resolveDirectUrl(mode);
  if (isStatus) {
    const applied = await countAppliedMigrations({ connectionString });
    console.log(`db:status ${mode} — ${applied} migration(s) applied`);
    return;
  }
  const applied = await applyMigrations({ connectionString });
  console.log(`db:migrate ${mode} — ${applied} migration(s) applied`);
};

main().catch((error: unknown) => {
  console.error(`db:migrate failed: ${(error as Error).message}`);
  process.exit(1);
});
