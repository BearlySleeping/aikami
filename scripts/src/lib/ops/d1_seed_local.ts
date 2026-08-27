#!/usr/bin/env bun
// scripts/src/lib/ops/d1_seed_local.ts
//
// C-437: Seed the local D1 database with dev data.
//
// Seeds one dev user (via Better Auth's API), one pack, and one pack version.
// Idempotent: running twice produces identical row counts and exits zero.
// Refuses to run against non-local state.
//
// Prerequisites:
//   1. The hub-worker must be running (`bun herdr:start hub-worker`)
//   2. Migrations must be applied (`bun run db:migrate:local`)
//
// Usage:
//   bun run scripts/src/lib/ops/d1_seed_local.ts
//   bun run db:seed:local  (from apps/frontend/hub)

import { resolve } from 'node:path';
import { PORTS } from '@aikami/constants';
import { c, error, info, ok } from '../cli_utils.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');
const DB_NAME = 'aikami-hub';
const HUB_WORKER_PORT = Number(process.env.PORT) || PORTS.emulator.hubWorker;
const HUB_WORKER_URL = `http://127.0.0.1:${HUB_WORKER_PORT}`;

// ── Seed data ───────────────────────────────────────────────
// Must be obviously fake so it can never be mistaken for production data.
const DEV_USER = { name: 'Dev User', email: 'dev@localhost', password: 'dev-password-123' };
const DEV_PACK = {
  name: 'Dev Test Pack',
  slug: 'dev-test-pack',
  description: 'A local dev pack for testing',
};

// ── Helpers ─────────────────────────────────────────────────
const wrangler = async (
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const proc = Bun.spawn(['bunx', 'wrangler', ...args], {
    cwd: HUB_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
};

const d1Exec = async (
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
  wrangler(['d1', 'execute', DB_NAME, '--local', '--command', command, '--yes']);

const checkLocalMode = (): void => {
  // 🔴 Guard: refuse to run against non-local state.
  // If CLOUDFLARE_API_TOKEN is set, wrangler might reach remote D1.
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.length > 0) {
    error('CLOUDFLARE_API_TOKEN is set — refusing to seed (may target remote D1).');
    info('Unset CLOUDFLARE_API_TOKEN or run in a clean shell:');
    info(`  ${c.cyan}unset CLOUDFLARE_API_TOKEN && bun run db:seed:local${c.reset}`);
    process.exit(1);
  }
};

const checkHubWorkerRunning = async (): Promise<void> => {
  try {
    const res = await fetch(`${HUB_WORKER_URL}/`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok && res.status >= 500) {
      throw new Error(`hub-worker returned ${res.status}`);
    }
  } catch {
    error(`hub-worker does not appear to be running on :${HUB_WORKER_PORT}`);
    info('Start the hub-worker first:');
    info(`  ${c.cyan}bun herdr:start hub-worker${c.reset}`);
    info('Then run the seed:');
    info(`  ${c.cyan}bun run db:seed:local${c.reset}`);
    process.exit(1);
  }
};

const seedExists = async (): Promise<boolean> => {
  // Check user exists
  const { stdout: userCheck, exitCode: userExit } = await d1Exec(
    "SELECT COUNT(*) as cnt FROM user WHERE email = 'dev@localhost'",
  );
  if (userExit !== 0) {
    return false; // Table may not exist yet
  }
  const userExists =
    userCheck.includes('"cnt":1') || userCheck.includes('cnt|1') || userCheck.includes('1');
  if (!userExists) {
    return false;
  }

  // Check pack version exists (ensures full seed, not just user)
  const { stdout: pvCheck, exitCode: pvExit } = await d1Exec(
    `SELECT COUNT(*) as cnt FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id WHERE p.slug = '${DEV_PACK.slug}'`,
  );
  if (pvExit !== 0) {
    return false;
  }
  return pvCheck.includes('"cnt":1') || pvCheck.includes('cnt|1') || pvCheck.includes('1');
};

const createDevUser = async (): Promise<void> => {
  info('Creating dev user via Better Auth...');
  const res = await fetch(`${HUB_WORKER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(DEV_USER),
  });

  if (res.status === 200) {
    ok(`Dev user created: ${DEV_USER.email}`);
    return;
  }

  // 422 = user already exists (idempotent)
  if (res.status === 422) {
    ok(`Dev user already exists: ${DEV_USER.email} (idempotent)`);
    return;
  }

  const body = await res.text().catch(() => '(no body)');
  error(`Failed to create dev user: HTTP ${res.status} — ${body}`);
  process.exit(1);
};

const createDevPack = async (): Promise<void> => {
  info('Creating dev pack...');

  // Get the dev user's ID
  const { stdout, exitCode } = await d1Exec(
    "SELECT id FROM user WHERE email = 'dev@localhost' LIMIT 1",
  );
  if (exitCode !== 0 || !stdout) {
    error('Could not find dev user in database');
    process.exit(1);
  }

  // Parse the user ID from wrangler's table output
  // Format: id|... or {"id":"..."}
  const userIdMatch =
    stdout.match(/(?:id\|([^\s]+)|"id":"([^"]+))/) ||
    stdout.match(/id[^a-zA-Z0-9]*([a-zA-Z0-9-]+)/);
  const userId = userIdMatch?.[1] || userIdMatch?.[2];
  if (!userId) {
    error(`Could not parse user ID from output: ${stdout}`);
    process.exit(1);
  }

  // Check if pack already exists (idempotent) — query by slug
  const { stdout: packCheck, exitCode: packCheckExit } = await d1Exec(
    `SELECT COUNT(*) as cnt FROM packs WHERE slug = '${DEV_PACK.slug}'`,
  );
  if (packCheckExit !== 0) {
    error('Failed to query packs table');
    process.exit(1);
  }
  if (packCheck.includes('"cnt":1') || packCheck.includes('cnt|1') || packCheck.includes('1')) {
    ok(`Dev pack already exists: ${DEV_PACK.slug} (idempotent)`);
    return;
  }

  // Insert the pack — D1 schema: id, slug, owner_account_id, visibility, created_at, updated_at
  const now = Date.now();
  const packId = crypto.randomUUID();
  const { exitCode: packExit } = await d1Exec(
    `INSERT INTO packs (id, slug, owner_account_id, visibility, created_at, updated_at) ` +
      `VALUES ('${packId}', '${DEV_PACK.slug}', '${userId}', 'draft', ${now}, ${now})`,
  );
  if (packExit !== 0) {
    error('Failed to create dev pack');
    process.exit(1);
  }

  // Insert a pack version — D1 schema: id, pack_id, version (text), manifest_hash, created_at
  const versionId = crypto.randomUUID();
  const fakeManifestHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const { exitCode: versionExit } = await d1Exec(
    `INSERT INTO pack_versions (id, pack_id, version, manifest_hash, created_at) ` +
      `VALUES ('${versionId}', '${packId}', '1', '${fakeManifestHash}', ${now})`,
  );
  if (versionExit !== 0) {
    error('Failed to create dev pack version');
    process.exit(1);
  }

  ok(`Dev pack created: ${DEV_PACK.name} (version 1)`);
};

// ── Main ────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  info('D1 Local Seed');
  info('─────────────');

  checkLocalMode();
  ok('Local mode confirmed');

  await checkHubWorkerRunning();
  ok(`hub-worker is running on :${HUB_WORKER_PORT}`);

  // Idempotency check
  if (await seedExists()) {
    ok('Seed data already exists — nothing to do (idempotent)');
    process.exit(0);
  }

  await createDevUser();
  await createDevPack();

  ok('');
  ok('Seed complete!');
  info('You can now sign in with:');
  info(`  Email:    ${c.cyan}${DEV_USER.email}${c.reset}`);
  info(`  Password: ${c.cyan}${DEV_USER.password}${c.reset}`);
};

await main();
