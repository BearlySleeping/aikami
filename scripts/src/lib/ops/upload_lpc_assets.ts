// scripts/src/lib/ops/upload_lpc_assets.ts
/**
 * Upload LPC assets to Firebase Storage.
 *
 * Walks apps/frontend/client/src/lib/assets/lpc and uploads every .webp file
 * to Firebase Storage under the `lpc/` prefix, preserving directory structure.
 *
 * Usage:
 *   bun run scripts/src/lib/ops/upload_lpc_assets.ts [--mode emulator|staging|production]
 *
 *   --mode    Target environment (default: emulator).
 *             emulator    → local storage emulator (port 9198, no auth)
 *             staging     → aikami-dev.firebasestorage.app
 *             production  → aikami-prod.firebasestorage.app
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { $ } from 'bun';

// ── Configuration ──────────────────────────────────────────────────────────

const LPC_ASSETS_DIR = join(
  import.meta.dirname,
  '../../../..',
  'apps',
  'frontend',
  'client',
  'src',
  'lib',
  'assets',
  'lpc',
);

const STORAGE_PREFIX = 'lpc';

const EMULATOR_STORAGE_PORT = 9198;
const EMULATOR_PROJECT_ID = 'demo-aikami-emulator';

const PROJECT_MAP = {
  emulator: EMULATOR_PROJECT_ID,
  staging: 'aikami-dev',
  production: 'aikami-prod',
} as const;

/** Maximum parallel uploads. */
const CONCURRENCY = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive the storage bucket name from a Firebase project ID.
 *
 * Emulator uses `{project}.appspot.com`; live projects use
 * `{project}.firebasestorage.app`.
 */
const getBucket = (projectId: string, mode: string): string => {
  if (mode === 'emulator') {
    return `${projectId}.appspot.com`;
  }
  return `${projectId}.firebasestorage.app`;
};

/**
 * Build the Firebase Storage REST base URL.
 */
const getStorageBase = (bucket: string, mode: string): string => {
  if (mode === 'emulator') {
    return `http://localhost:${EMULATOR_STORAGE_PORT}/v0/b/${bucket}/o`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o`;
};

/**
 * Get an access token for live (non-emulator) environments.
 *
 * Uses `gcloud auth application-default print-access-token`.
 * Cached for the lifetime of the process.
 */
let _cachedToken: string | null = null;

const getAccessToken = async (): Promise<string> => {
  if (_cachedToken) {
    return _cachedToken;
  }
  const result = await $`gcloud auth application-default print-access-token`.quiet();
  _cachedToken = result.stdout.toString().trim();
  return _cachedToken;
};

/**
 * Encode a path for use in a Firebase Storage URL.
 *
 * Firebase Storage expects the object name to be URL-encoded, with `/`
 * encoded as `%2F`.
 */
const encodeStoragePath = (path: string): string => {
  return encodeURIComponent(path);
};

// ── Upload ─────────────────────────────────────────────────────────────────

/**
 * Upload a single file to Firebase Storage.
 *
 * @returns The download URL on success, or null on failure.
 */
const uploadFile = async (options: {
  baseUrl: string;
  localPath: string;
  storagePath: string;
  accessToken?: string;
  mode: string;
}): Promise<boolean> => {
  const { baseUrl, localPath, storagePath, accessToken, mode } = options;

  const fileBytes = readFileSync(localPath);
  const encodedPath = encodeStoragePath(storagePath);
  const url = `${baseUrl}?name=${encodedPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'image/webp',
  };

  if (mode !== 'emulator' && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: fileBytes,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`  ❌ Upload failed (${response.status}): ${localPath}`);
      if (body) {
        console.error(`     ${body.slice(0, 200)}`);
      }
      return false;
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Upload error: ${localPath} — ${message}`);
    return false;
  }
};

// ── Directory walk ─────────────────────────────────────────────────────────

/**
 * Recursively collect all .webp files under a directory.
 */
const collectWebpFiles = (dir: string): string[] => {
  const results: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    const { readdirSync } = require('node:fs');
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.endsWith('.webp')) {
        results.push(fullPath);
      }
    }
  }

  return results;
};

// ── Main ───────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = (modeIndex >= 0 ? args[modeIndex + 1] : 'emulator') as keyof typeof PROJECT_MAP;

  if (!(mode in PROJECT_MAP)) {
    console.error(`❌ Invalid mode: ${mode}. Use emulator, staging, or production.`);
    process.exit(1);
  }

  const projectId = PROJECT_MAP[mode];
  const bucket = getBucket(projectId, mode);
  const baseUrl = getStorageBase(bucket, mode);

  console.log(`📤 Uploading LPC assets to Firebase Storage`);
  console.log(`   Mode:    ${mode}`);
  console.log(`   Project: ${projectId}`);
  console.log(`   Bucket:  ${bucket}`);
  console.log(`   Prefix:  ${STORAGE_PREFIX}/`);
  console.log('');

  // Check source directory exists
  if (!existsSync(LPC_ASSETS_DIR)) {
    console.error(`❌ LPC assets directory not found: ${LPC_ASSETS_DIR}`);
    process.exit(1);
  }

  // Collect files
  const files = collectWebpFiles(LPC_ASSETS_DIR);
  console.log(`📁 Found ${files.length.toLocaleString()} .webp files in lpc/`);
  console.log('');

  // Compute total size
  const totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`   Total size: ${totalMb} MB`);
  console.log('');

  // Get access token for live environments
  let accessToken: string | undefined;
  if (mode !== 'emulator') {
    console.log('🔑 Authenticating with gcloud...');
    try {
      accessToken = await getAccessToken();
      console.log('   ✅ Got access token');
    } catch {
      console.error('   ❌ Failed to get access token. Run: gcloud auth application-default login');
      process.exit(1);
    }
    console.log('');
  } else {
    console.log('🔧 Using local storage emulator (no auth)');
    console.log('');
  }

  // Upload in parallel batches
  const total = files.length;
  let uploaded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = files.slice(i, Math.min(i + CONCURRENCY, total));
    const batchNumber = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(total / CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (localPath) => {
        const relPath = relative(LPC_ASSETS_DIR, localPath);
        const storagePath = `${STORAGE_PREFIX}/${relPath}`;
        return uploadFile({ baseUrl, localPath, storagePath, accessToken, mode });
      }),
    );

    const batchOk = results.filter(Boolean).length;
    const batchFail = results.length - batchOk;
    uploaded += batchOk;
    failed += batchFail;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const percent = ((uploaded / total) * 100).toFixed(1);
    const rate = uploaded > 0 ? (uploaded / Number.parseFloat(elapsed)).toFixed(1) : '0';

    console.log(
      `   [${batchNumber}/${totalBatches}] ${percent}% — ${uploaded}/${total} uploaded, ${failed} failed — ${elapsed}s (${rate}/s)`,
    );
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('📊 Upload Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`   Total:    ${total.toLocaleString()} files`);
  console.log(`   Uploaded: ${uploaded.toLocaleString()} ✅`);
  console.log(`   Failed:   ${failed.toLocaleString()} ${failed > 0 ? '❌' : ''}`);
  console.log(`   Time:     ${elapsed}s`);
  console.log(`   Bucket:   gs://${bucket}/${STORAGE_PREFIX}/`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }

  console.log('✅ All LPC assets uploaded successfully.');
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Fatal error:', message);
  process.exit(1);
});
