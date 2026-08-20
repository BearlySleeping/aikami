#!/usr/bin/env bun

// scripts/src/lib/dist/upload_ort.ts
//
// Upload the vendored onnxruntime-web WASM to the R2 distribution plane
// (`aikami-dist`), so the client fetches it at runtime instead of bundling
// it (shrinks the shipped bundle / git footprint — see
// docs/architecture/object-storage-layout.md §7, open question 5).
//
// Only the JSEP variant is needed: the client uses a single
// `import('onnxruntime-web/webgpu')` (JSEP-enabled) which locates
// `ort-wasm-simd-threaded.jsep.wasm` via wasmPaths for both the WebGPU and
// WASM fallback backends.
//
// The object is stored content-versioned so the URL is immutable:
//   models/ort/<ort-version>/ort-wasm-simd-threaded.jsep.wasm
// The client points wasmPaths at
//   <origin>/models/ort/<ort-version>/
// and onnxruntime appends the jsep.wasm filename.
//
// Usage:
//   bun run scripts/src/lib/dist/upload_ort.ts [--mode production]
//
// Env (scripts/.env.{mode}): CLOUD_FLARE_DIST_BUCKET_* + CATALOG_ORIGIN_URL_DIST.

import { resolveDistConfig } from './config.ts';

const ORT_VERSION = '1.27.0';
const JSEP_WASM = 'ort-wasm-simd-threaded.jsep.wasm';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'production';

const config = resolveDistConfig(mode);
console.log('🚀 ORT WASM upload → dist plane');
console.log(`   Mode:    ${mode}`);
console.log(`   Bucket:  ${config.bucket}`);
console.log(`   Origin:  ${config.originUrl}`);

const s3 = new Bun.S3Client({
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  bucket: config.bucket,
  endpoint: config.endpoint,
  region: 'auto',
});

// Resolve the vendored wasm from the onnxruntime-web npm dist (pinned by
// package-lock / bun.lock). It is NOT committed to git — the canonical copy
// lives in R2 after this upload runs.
const repoRoot = new URL('../../../..', import.meta.url).pathname;
const sourcePath = `${repoRoot}/node_modules/.bun/onnxruntime-web@1.27.0/node_modules/onnxruntime-web/dist/${JSEP_WASM}`;
const fallbackPath = `${repoRoot}/apps/frontend/client/static/ort/${JSEP_WASM}`;
const sourcePathToUse =
  (await Bun.file(sourcePath).exists()) ? sourcePath : fallbackPath;
const source = Bun.file(sourcePathToUse);
if (!(await source.exists())) {
  console.error(`❌ onnxruntime wasm not found; tried ${sourcePath} and ${fallbackPath}`);
  process.exit(1);
}

const key = `models/ort/${ORT_VERSION}/${JSEP_WASM}`;

// Idempotent: skip if the content-addressed-by-version object already exists.
const existing = await s3.list({ prefix: `models/ort/${ORT_VERSION}/` });
const alreadyThere = (existing.contents ?? []).some((o) => o.key === key);
if (alreadyThere) {
  console.log(`⏭  Already present: ${key}`);
} else {
  // Immutable, one-year cache — the version in the key makes it permanent.
  // Bun's S3 client does not expose per-object Cache-Control on write(), so
  // the PUT goes through a presigned URL with explicit headers (same technique
  // as catalog/upload.ts).
  const body = await source.arrayBuffer();
  const url = s3.file(key).presign({ method: 'PUT', expiresIn: 300 });
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'application/wasm',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`❌ S3 PUT ${key} failed (${response.status}) ${text.slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`✅ Uploaded ${key} (${(body.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

const wasmPath = `${config.originUrl}/models/ort/${ORT_VERSION}/`;
console.log('');
console.log('📌 wasmPaths base URL for the client:');
console.log(`   ${wasmPath}`);
console.log('');
console.log('   The Canonical copy now lives in R2; static/ort/ is no longer bundled.');
