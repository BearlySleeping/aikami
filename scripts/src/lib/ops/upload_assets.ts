// scripts/src/lib/ops/upload_assets.ts
//
// Uploads bundled game assets (music / sfx / ambient / sprites / backgrounds)
// to Firebase Storage so the C-373 AssetManager can fall back to an online
// origin, and uploads the online registry seed (manifest.json +
// asset_hashes.json — the "turso" seed files) so clients can discover the
// available-asset catalog from the bucket.
//
// Storage layout mirrors the bundled tree — an asset at
// static/game-data/music/exploration/Chainsmoker.mp3 lives at
// gs://<bucket>/music/exploration/Chainsmoker.mp3, which is exactly the
// `firebase-storage` source URL the registry seeds (see
// AssetRegistryRepository.addFirebaseStorageSources). LPC has its own
// uploader (upload_lpc_assets.ts) because of its size (12k+ files).
//
// Usage:
//   bun run scripts/src/lib/ops/upload_assets.ts [--mode emulator|staging|production]
//
//   emulator    → local storage emulator (port 9198, no auth)
//   staging     → aikami-staging.firebasestorage.app
//   production  → aikami-production.firebasestorage.app

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { EMULATOR_PORTS, EMULATOR_PROJECT_ID } from '@aikami/constants';
import { $ } from 'bun';

/** Firebase project ID per mode. */
const PROJECT_MAP = {
  emulator: EMULATOR_PROJECT_ID,
  staging: 'aikami-staging',
  production: 'aikami-production',
} as const;

/** Maximum parallel uploads. */
const CONCURRENCY = 8;

/** Repo-relative source directories (first path segment = storage prefix). */
const SOURCE_DIRS = ['music', 'sfx', 'ambient', 'sprites', 'backgrounds'] as const;

/** Seed files uploaded to the bucket as the online registry catalog. */
const SEED_FILES = [
  { local: 'manifest.json', storage: 'game-data/manifest.json' },
  { local: 'asset_hashes.json', storage: 'game-data/asset_hashes.json' },
] as const;

/** MIME type per extension; falls back to application/octet-stream. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const ROOT = resolve(import.meta.dirname, '../../../..');
const GAME_DATA_DIR = resolve(ROOT, 'apps/frontend/client/static/game-data');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Derive the storage bucket name from a Firebase project ID. */
const getBucket = (projectId: string, mode: string): string => {
  if (mode === 'emulator') {
    return `${projectId}.appspot.com`;
  }
  return `${projectId}.firebasestorage.app`;
};

/** Build the Firebase Storage REST base URL. */
const getStorageBase = (bucket: string, mode: string): string => {
  if (mode === 'emulator') {
    return `http://localhost:${EMULATOR_PORTS.storage}/v0/b/${bucket}/o`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o`;
};

let _cachedToken: string | null = null;

/** Get a gcloud application-default access token (live environments only). */
const getAccessToken = async (): Promise<string> => {
  if (_cachedToken) {
    return _cachedToken;
  }
  const result = await $`gcloud auth application-default print-access-token`.quiet();
  _cachedToken = result.stdout.toString().trim();
  return _cachedToken;
};

/** Encode a path for use in a Firebase Storage URL (`/` → `%2F`). */
const encodeStoragePath = (path: string): string => encodeURIComponent(path);

/**
 * Upload a single file to Firebase Storage.
 * @returns true on success.
 */
const uploadFile = async (options: {
  baseUrl: string;
  localPath: string;
  storagePath: string;
  accessToken?: string;
  mode: string;
}): Promise<boolean> => {
  const { baseUrl, localPath, storagePath, accessToken, mode } = options;

  const encodedPath = encodeStoragePath(storagePath);
  const url = `${baseUrl}?name=${encodedPath}`;

  const headers: Record<string, string> = {
    'Content-Type':
      CONTENT_TYPE_BY_EXT[extname(localPath).toLowerCase()] ?? 'application/octet-stream',
  };
  if (mode !== 'emulator' && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const fileBytes = readFileSync(localPath);
    const response = await fetch(url, { method: 'POST', headers, body: fileBytes });
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

/** Recursively collect files of the given extensions under a directory. */
const collectFiles = (dir: string, exts: readonly string[]): string[] => {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (exts.includes(extname(entry.name).toLowerCase())) {
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

  console.log(`📤 Uploading game assets + registry seed to Firebase Storage`);
  console.log(`   Mode:    ${mode}`);
  console.log(`   Project: ${projectId}`);
  console.log(`   Bucket:  ${bucket}`);
  console.log('');

  // Collect asset files from each category tree (audio + image extensions).
  const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.webm', '.flac', '.m4a', '.aac'];
  const IMAGE_EXTS = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif', '.svg'];
  const audioFiles: { localPath: string; storagePath: string }[] = [];
  for (const dir of SOURCE_DIRS) {
    const srcDir = join(GAME_DATA_DIR, dir);
    if (!existsSync(srcDir)) {
      console.log(`   (skipping ${dir}/ — not present)`);
      continue;
    }
    for (const localPath of collectFiles(srcDir, [...AUDIO_EXTS, ...IMAGE_EXTS, '.json'])) {
      const relPath = relative(srcDir, localPath);
      audioFiles.push({ localPath, storagePath: `${dir}/${relPath}` });
    }
  }

  const seedFiles: { localPath: string; storagePath: string }[] = [];
  let skippedSeeds = 0;
  for (const { local, storage } of SEED_FILES) {
    const localPath = join(GAME_DATA_DIR, local);
    if (existsSync(localPath)) {
      seedFiles.push({ localPath, storagePath: storage });
    } else {
      skippedSeeds++;
    }
  }

  const allFiles = [...audioFiles, ...seedFiles];
  console.log(
    `📁 Found ${audioFiles.length} asset file(s) + ${seedFiles.length} seed file(s)` +
      (skippedSeeds > 0 ? ` (${skippedSeeds} seed file(s) skipped — missing)` : ''),
  );
  console.log('');

  // Authenticate for live environments.
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

  // Upload in parallel batches.
  let uploaded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
    const batch = allFiles.slice(i, Math.min(i + CONCURRENCY, allFiles.length));
    const results = await Promise.all(
      batch.map(({ localPath, storagePath }) =>
        uploadFile({ baseUrl, localPath, storagePath, accessToken, mode }),
      ),
    );
    uploaded += results.filter(Boolean).length;
    failed += results.length - results.filter(Boolean).length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`✅ Upload complete — ${uploaded} uploaded, ${failed} failed in ${elapsed}s`);
  if (failed > 0) {
    process.exit(1);
  }
};

await main();
