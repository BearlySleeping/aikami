#!/usr/bin/env bun
// scripts/src/lib/deploy/purge_mutable_client_assets.ts
//
// Purge Cloudflare's edge cache for the MUTABLE, non-content-hashed files a
// web deploy rewrites: `/_app/env.js` and `/_app/version.json`.
//
// Why this exists: `apps/frontend/client/static/_headers` marks `/*.js` as
// `immutable, max-age=1yr`. That is correct for SvelteKit's content-hashed
// `/_app/immutable/*` chunks, but `/_app/env.js` and `/_app/version.json`
// keep a STABLE url while their content changes every deploy. A client (or the
// edge) that cached the previous copy therefore never revalidates, so a
// corrected deploy silently does not take effect — the staging client kept
// resolving the production catalog origin and rendering the legacy map.
//
// The `_headers` rule now overrides those two paths with
// `max-age=0, must-revalidate`, but an already-cached `immutable` response is
// only re-fetched once purged. This step does that, per deploy.
//
// Invoked by release.yml after the Cloudflare deploy. It is a no-op without
// CLOUDFLARE_API_TOKEN (e.g. a local run), never fails a deploy on a purge
// error, and only ever purges the two specific URLs for the deployed mode's
// domains.

import { parseArgs } from 'node:util';
import { APP_CONFIG } from './deployment_config.ts';

type CfApp = { cloudflare?: { routes?: Partial<Record<string, string>> } };

const MUTABLE_SUFFIXES = ['/_app/env.js', '/_app/version.json'] as const;

/** Apex = last two labels (`aikami.stg.bearlysleeping.com` → `bearlysleeping.com`). */
const apexOf = (hostname: string): string => hostname.split('.').slice(-2).join('.');

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: { mode: { type: 'string' } },
  strict: false,
  allowPositionals: true,
});

const mode = (values.mode as string | undefined) ?? process.env.MODE ?? '';
if (!mode) {
  console.error('purge_mutable_client_assets: --mode is required');
  process.exit(1);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.warn('  ⚠️  purge_mutable_client_assets: CLOUDFLARE_API_TOKEN not set — skipping purge');
  process.exit(0);
}

const apps = positionals.length > 0 ? positionals : ['client', 'site', 'docs', 'hub'];

const urls = new Set<string>();
for (const app of apps) {
  const route = (APP_CONFIG as Record<string, CfApp>)[app]?.cloudflare?.routes?.[mode];
  if (!route) {
    continue;
  }
  const origin = `https://${route}`;
  for (const suffix of MUTABLE_SUFFIXES) {
    urls.add(`${origin}${suffix}`);
  }
}

if (urls.size === 0) {
  console.log(`  ℹ️  purge_mutable_client_assets: no ${mode} routes to purge`);
  process.exit(0);
}

const zoneCache = new Map<string, string | undefined>();
const zoneIdFor = async (apex: string): Promise<string | undefined> => {
  if (zoneCache.has(apex)) {
    return zoneCache.get(apex);
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await response.json()) as {
    success?: boolean;
    result?: Array<{ id: string }>;
  };
  const id = body.success ? body.result?.[0]?.id : undefined;
  zoneCache.set(apex, id);
  return id;
};

let purged = 0;
for (const url of urls) {
  const zoneId = await zoneIdFor(apexOf(new URL(url).hostname));
  if (!zoneId) {
    console.warn(`  ⚠️  purge: no zone found for ${url}`);
    continue;
  }
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [url] }),
      },
    );
    const body = (await response.json()) as { success?: boolean; errors?: unknown };
    if (body.success) {
      purged++;
      console.log(`  🧹 purged ${url}`);
    } else {
      console.warn(`  ⚠️  purge failed for ${url}: ${JSON.stringify(body.errors)}`);
    }
  } catch (error) {
    console.warn(`  ⚠️  purge errored for ${url}: ${(error as Error).message}`);
  }
}

console.log(`  ✅ purge_mutable_client_assets: ${purged}/${urls.size} url(s) purged`);
