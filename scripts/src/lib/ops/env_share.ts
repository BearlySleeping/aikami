#!/usr/bin/env bun
// scripts/src/lib/ops/env_share.ts
//
// Share .env.{mode} files between workflow jobs via Upstash Redis.
//
// The release pipeline fetches secrets ONCE (plan job → download_secrets) and
// every downstream job (build-web + desktop matrix legs) needs the same
// .env.{mode} files. Re-fetching per job spawned concurrent `gcloud`
// processes that collide on gcloud's config/token cache — Windows enforces
// strict file locks and fails with "file is being used by another process".
// Passing the files as workflow artifacts would expose env content on a
// PUBLIC repo run. Instead:
//
//   --put  (plan job)     store both env files under a per-run Redis key
//                         `env-files:{mode}:{run_id}` with a 4h TTL.
//   --get  (downstream)   restore them from the same key.
//
// The key is derived from the deploy mode + GITHUB_RUN_ID, so no job-output
// plumbing is needed and nothing sensitive ever appears in the run. Values
// are only readable by processes holding REDIS_TOKEN (passed to the --get
// steps via GitHub secrets; loaded from scripts/.env.{mode} for --put).
//
// Usage (CI):
//   bun scripts/src/lib/ops/env_share.ts --mode=production --put
//   bun scripts/src/lib/ops/env_share.ts --mode=production --get
//   env: GITHUB_RUN_ID (auto-set by GitHub Actions), REDIS_URL, REDIS_TOKEN

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, error, log, ok, parseCliArgs } from '../cli_utils';
import { initScriptsEnv } from '../env/scripts_env';
import { resolveEnvFile } from '../deploy/deployment_config';

const _filename = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_filename);
const ROOT_DIR = resolve(_scriptDir, '../../../..');

/** App dirs whose .env.{mode} files are shared with every desktop job. */
const ENV_FILE_DIRS: Record<string, string> = {
  scripts: join(ROOT_DIR, 'scripts'),
  client: join(ROOT_DIR, 'apps/frontend/client'),
};

/** Legs consume the files within ~30 min of the plan job; 4h is generous. */
const TTL_SECONDS = 4 * 60 * 60;

function redisCreds(): { url: string; token: string } {
  const url = process.env.REDIS_URL;
  const token = process.env.REDIS_TOKEN;
  if (!url || !token) {
    error(
      'REDIS_URL / REDIS_TOKEN not set — --put loads them from scripts/.env.{mode} ' +
        'via initScriptsEnv; --get steps must pass them via GitHub secrets.',
    );
    process.exit(1);
  }
  return { url, token };
}

async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const { url, token } = redisCreds();
  log(`  ${c.dim}Redis SET ${key} (EX ${ttlSeconds})${c.reset}`);
  const res = await fetch(`${url}/set/${key}?EX=${ttlSeconds}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: value,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    error(`Redis SET ${key} failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
}

async function redisGet(key: string): Promise<string | null> {
  const { url, token } = redisCreds();
  log(`  ${c.dim}Redis GET ${key}${c.reset}`);
  const res = await fetch(`${url}/get/${key}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    error(`Redis GET ${key} failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const data = (await res.json()) as { result: string | null };
  return data.result ?? null;
}

async function main(): Promise<void> {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    mode: { type: 'string', map: { prod: 'production', stg: 'staging' } },
    put: { type: 'boolean' },
    get: { type: 'boolean' },
  });
  const mode = opts.mode ?? 'production';
  const runId = process.env.GITHUB_RUN_ID;
  if (!runId) {
    error('GITHUB_RUN_ID is required (GitHub Actions sets it automatically).');
    process.exit(1);
  }
  if (opts.put === opts.get) {
    error('Pass exactly one of --put or --get.');
    process.exit(1);
  }

  // --put: REDIS creds come from scripts/.env.{mode} (plan job already ran
  // download_secrets). --get: creds arrive via GitHub-secret env vars.
  initScriptsEnv(mode);

  const key = `env-files:${mode}:${runId}`;
  const files = Object.entries(ENV_FILE_DIRS).map(([name, dir]) => ({
    name,
    path: join(dir, resolveEnvFile(mode)),
  }));

  if (opts.put) {
    const payload: Record<string, string> = {};
    for (const f of files) {
      if (!existsSync(f.path)) {
        error(`Missing ${f.path} — run download_secrets.ts first.`);
        process.exit(1);
      }
      payload[f.name] = readFileSync(f.path, 'utf8');
    }
    await redisSet(key, JSON.stringify(payload), TTL_SECONDS);
    ok(`Stored env files under ${c.cyan}${key}${c.reset} (TTL ${TTL_SECONDS / 3600}h)`);
    return;
  }

  const raw = await redisGet(key);
  if (!raw) {
    error(
      `No env files found for ${key} — did the plan job run download_secrets.ts + env_share.ts --put?`,
    );
    process.exit(1);
  }
  const payload = JSON.parse(raw) as Record<string, string>;
  for (const f of files) {
    const content = payload[f.name];
    if (content === undefined) {
      error(`Env file "${f.name}" missing from shared payload ${key}.`);
      process.exit(1);
    }
    writeFileSync(f.path, content);
  }
  ok(`Restored ${files.length} env file(s) from ${c.cyan}${key}${c.reset}`);
}

await main();
