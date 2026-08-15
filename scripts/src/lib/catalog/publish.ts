#!/usr/bin/env bun

// scripts/src/lib/catalog/publish.ts
//
// CLI entry point for the catalog publish pipeline (C-395).
//
// Publishes the bundled asset library to the R2 origin under
// content-addressed keys, runs the attribution preflight, and publishes the
// catalog index (root + category shards).
//
// Usage:
//   bun run scripts/src/lib/catalog/publish.ts [--mode production]
//
// Env (scripts/.env.{mode}, see scripts/.env.example):
//   CLOUD_FLARE_BUCKET_ACCESS_KEY_ID / SECRET_ACCESS_KEY / ENDPOINT
//   CATALOG_ORIGIN_URL               public origin (injected, never hardcoded)
//   CATALOG_BUCKET                   optional, default aikami-catalog
//
// Idempotent: re-running skips existing content-addressed objects. The index
// is written last. Exits non-zero on any failure or preflight violation.

import { resolveCatalogConfig } from './config.ts';
import { runCatalogPublish } from './pipeline.ts';
import { createR2Client } from './upload.ts';

const modeIndex = process.argv.indexOf('--mode');
if (modeIndex >= 0 && !process.argv[modeIndex + 1]) {
  console.error('❌ --mode requires a value (e.g. --mode production).');
  process.exit(1);
}
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'production';

const config = resolveCatalogConfig(mode);
console.log('🚀 Catalog publish');
console.log(`   Mode:    ${mode}`);
console.log(`   Bucket:  ${config.bucket}`);
console.log(`   Origin:  ${config.originUrl}`);
console.log('');

const client = createR2Client(config);
const report = await runCatalogPublish({ config, client });

if (!report.ok) {
  console.error('\n❌ Catalog publish FAILED — exiting non-zero.');
  process.exit(1);
}
console.log('\n✅ Catalog publish complete.');
