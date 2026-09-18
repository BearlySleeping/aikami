#!/usr/bin/env bun

// scripts/src/lib/dist/apply_r2_cors.ts
//
// Apply the committed CORS policy to the `aikami-dist` R2 bucket.
//
// Why this exists
// ---------------
// The client Worker fetches ORT runtime assets (models/ort/<version>/) from
// dl.bearlysleeping.com — a different origin from the app. Without a bucket
// CORS policy, R2 serves the bytes but the browser refuses to expose them, so
// ONNX Runtime fails to initialize with an opaque network error. The policy
// itself is committed (`r2_cors_policy.json`) so it is reviewable and
// reproducible instead of a dashboard-only setting.
//
// Idempotent: `cf r2 buckets cors update` replaces the whole policy.
//
// Usage (from the scripts project, where the `cf` CLI is a dependency):
//   bun cf r2 buckets cors get aikami-dist              # inspect
//   bun run src/lib/dist/apply_r2_cors.ts               # apply
//
// Env: CLOUDFLARE_ACCOUNT_ID or the active `cf` auth profile supplies the
// account; the bucket name defaults to `aikami-dist`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bucket = process.env.AIKAMI_DIST_BUCKET ?? 'aikami-dist';
const policyPath = join(import.meta.dir, 'r2_cors_policy.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<string, unknown>;
delete policy.$comment;

// biome-ignore lint/suspicious/noConsole: ops script reports to stdout/stderr
console.log(`Applying CORS policy to R2 bucket "${bucket}"...`);

const proc = Bun.spawn(
  ['bun', 'cf', 'r2', 'buckets', 'cors', 'update', bucket, '--body', JSON.stringify(policy)],
  { cwd: join(import.meta.dir, '..', '..', '..'), stdout: 'inherit', stderr: 'inherit' },
);

const exitCode = await proc.exited;
if (exitCode !== 0) {
  // biome-ignore lint/suspicious/noConsole: ops script reports to stdout/stderr
  console.error(`❌ Failed to apply CORS policy to ${bucket} (exit ${exitCode}).`);
  process.exit(exitCode);
}

// biome-ignore lint/suspicious/noConsole: ops script reports to stdout/stderr
console.log(`✅ Applied. Verify with: bun cf r2 buckets cors get ${bucket}`);
