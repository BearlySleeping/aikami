// scripts/src/lib/ops/download_lpc_assets.ts
/**
 * Download LPC assets from Firebase Storage.
 *
 * Lists all files under the `lpc/` prefix in Firebase Storage and downloads
 * them to apps/frontend/client/src/lib/assets/lpc, preserving directory
 * structure.
 *
 * Usage:
 *   bun run scripts/src/lib/ops/download_lpc_assets.ts [--mode emulator|staging|production]
 *
 *   --mode    Source environment (default: emulator).
 *             emulator    → local storage emulator (port 9198, no auth)
 *             staging     → aikami-dev.firebasestorage.app
 *             production  → aikami-prod.firebasestorage.app
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

/** Maximum parallel downloads. */
const CONCURRENCY = 20;

/** Page size for list operations (Firebase Storage REST API default is 1000). */
const LIST_PAGE_SIZE = 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive the storage bucket name from a Firebase project ID.
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
 * Get an access token for live environments.
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
 */
const encodeStoragePath = (path: string): string => {
  return encodeURIComponent(path);
};

// ── List files ─────────────────────────────────────────────────────────────

type StorageItem = {
  name: string;
  bucket: string;
};

type ListResponse = {
  items?: StorageItem[];
  nextPageToken?: string;
};

/**
 * List all files under a prefix in Firebase Storage.
 *
 * Handles pagination via `nextPageToken`.
 */
const listFiles = async (options: {
  baseUrl: string;
  prefix: string;
  accessToken?: string;
  mode: string;
}): Promise<StorageItem[]> => {
  const { baseUrl, prefix, accessToken, mode } = options;
  const headers: Record<string, string> = {};

  if (mode !== 'emulator' && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const results: StorageItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams();
    params.set('prefix', prefix);
    params.set('maxResults', String(LIST_PAGE_SIZE));

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const listUrl = `${baseUrl}?${params.toString()}`;

    const response = await fetch(listUrl, { headers });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`List failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as ListResponse;
    if (data.items) {
      results.push(...data.items);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
};

// ── Download ───────────────────────────────────────────────────────────────

/**
 * Download a single file from Firebase Storage.
 *
 * @returns True on success.
 */
const downloadFile = async (options: {
  baseUrl: string;
  storageName: string;
  localPath: string;
  accessToken?: string;
  mode: string;
}): Promise<boolean> => {
  const { baseUrl, storageName, localPath, accessToken, mode } = options;

  const encodedName = encodeStoragePath(storageName);
  const url = `${baseUrl}/${encodedName}?alt=media`;

  const headers: Record<string, string> = {};

  if (mode !== 'emulator' && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error(`  ❌ Download failed (${response.status}): ${storageName}`);
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Ensure parent directory exists
    const dir = dirname(localPath);
    mkdirSync(dir, { recursive: true });

    writeFileSync(localPath, buffer);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Download error: ${storageName} — ${message}`);
    return false;
  }
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

  console.log(`📥 Downloading LPC assets from Firebase Storage`);
  console.log(`   Mode:    ${mode}`);
  console.log(`   Project: ${projectId}`);
  console.log(`   Bucket:  ${bucket}`);
  console.log(`   Prefix:  ${STORAGE_PREFIX}/`);
  console.log(`   Target:  ${LPC_ASSETS_DIR}`);
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

  // List files
  console.log('🔍 Listing files in storage...');
  let items: StorageItem[];

  try {
    items = await listFiles({ baseUrl, prefix: `${STORAGE_PREFIX}/`, accessToken, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to list files: ${message}`);
    process.exit(1);
  }

  if (items.length === 0) {
    console.log('⚠️  No files found under lpc/ prefix.');
    console.log('   Run upload_lpc_assets.ts first.');
    process.exit(0);
  }

  console.log(`   Found ${items.length.toLocaleString()} files in storage`);
  console.log('');

  // Ensure target directory
  mkdirSync(LPC_ASSETS_DIR, { recursive: true });

  // Download in parallel batches
  const total = items.length;
  let downloaded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = items.slice(i, Math.min(i + CONCURRENCY, total));
    const batchNumber = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(total / CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (item) => {
        // Strip storage prefix to get relative path
        const relPath = item.name.startsWith(`${STORAGE_PREFIX}/`)
          ? item.name.slice(STORAGE_PREFIX.length + 1)
          : item.name;
        const localPath = join(LPC_ASSETS_DIR, relPath);

        return downloadFile({ baseUrl, storageName: item.name, localPath, accessToken, mode });
      }),
    );

    const batchOk = results.filter(Boolean).length;
    const batchFail = results.length - batchOk;
    downloaded += batchOk;
    failed += batchFail;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const percent = ((downloaded / total) * 100).toFixed(1);
    const rate = downloaded > 0 ? (downloaded / Number.parseFloat(elapsed)).toFixed(1) : '0';

    console.log(
      `   [${batchNumber}/${totalBatches}] ${percent}% — ${downloaded}/${total} downloaded, ${failed} failed — ${elapsed}s (${rate}/s)`,
    );
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('📊 Download Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`   Total:      ${total.toLocaleString()} files`);
  console.log(`   Downloaded: ${downloaded.toLocaleString()} ✅`);
  console.log(`   Failed:     ${failed.toLocaleString()} ${failed > 0 ? '❌' : ''}`);
  console.log(`   Time:       ${elapsed}s`);
  console.log(`   Output:     ${LPC_ASSETS_DIR}`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }

  console.log('✅ All LPC assets downloaded successfully.');
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Fatal error:', message);
  process.exit(1);
});
