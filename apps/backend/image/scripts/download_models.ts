// apps/backend/image/scripts/download_models.ts
// Idempotent, streaming model downloader for ComfyUI.
// Downloads checkpoints, LoRAs, and VAEs into apps/backend/image/src/models/.
//
// Usage:
//   bun run models:download                           # use env var or default URL
//   bun run models:download "https://example.com/model.safetensors"
//
// Environment:
//   AIKAMI_DEFAULT_CHECKPOINT_URL — fallback URL when no CLI arg given

import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────

const MODELS_DIR = resolve(import.meta.dirname, '../src/models');

/**
 * Model download configuration.
 *
 * - `name` — output filename
 * - `targetDir` — subdirectory under MODELS_DIR (e.g. `checkpoints/pixel-art`)
 * - `url` — resolved from CLI arg → env var → empty → skipped
 */
type ModelEntry = {
  name: string;
  /** Subdirectory path relative to MODELS_DIR. */
  targetDir: string;
  url: string;
};

/**
 * Model entries to download.
 *
 * URL resolution order:
 *   1. CLI argument (Bun.argv[2])
 *   2. AIKAMI_DEFAULT_CHECKPOINT_URL env var
 *   3. Empty — entry is skipped
 */
const resolveUrl = (): string => Bun.argv[2] ?? process.env.AIKAMI_DEFAULT_CHECKPOINT_URL ?? '';

const MODELS: ModelEntry[] = [
  {
    name: 'illustriousPixelart_v6SeriesV60.safetensors',
    targetDir: 'checkpoints/pixel-art',
    url: resolveUrl(),
  },
];

// ── Known Model URLs (CivitAI) ───────────────────────────────────────────
//
// Copy the URL below and pass as CLI arg or set AIKAMI_DEFAULT_CHECKPOINT_URL:
//
//   Illustrious PixelArt v6 (currently loaded):
//     https://civitai.com/models/1732312/illustrious-pixelart-from-hades
//
//   Pixel Perfect v20:
//     https://civitai.com/models/1870765/pixel-perfect
//
// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Ensure all parent directories exist, creating them recursively.
 */
const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

/**
 * Format bytes into a human-readable string.
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)}GB` : `${mb.toFixed(1)}MB`;
};

/**
 * Check if a model file exists and (optionally) matches an expected size.
 * Returns true if the file is already cached and complete.
 */
const isCached = (filePath: string, expectedSize?: number): boolean => {
  if (!existsSync(filePath)) {
    return false;
  }
  if (expectedSize !== undefined) {
    const stat = statSync(filePath);
    return stat.size === expectedSize;
  }
  // Without expected size, just check existence and non-zero
  const stat = statSync(filePath);
  return stat.size > 0;
};

// ── Streaming Download ───────────────────────────────────────────────────

/**
 * Download a single model with chunked streaming and progress reporting.
 *
 * Uses pure Bun APIs (fetch, FileSink.writer) for memory-efficient
 * streaming. Chunks are written directly to disk — no accumulation
 * in memory beyond the current chunk buffer.
 */
const downloadModel = async (entry: ModelEntry): Promise<void> => {
  const destDir = resolve(MODELS_DIR, entry.targetDir);
  const filePath = resolve(destDir, entry.name);

  // ── Guard: check idempotency ──────────────────────
  if (isCached(filePath)) {
    console.log(`○ ${entry.name} already cached, skipping.`);
    return;
  }

  // ── Guard: ensure directories exist ───────────────
  ensureDir(destDir);

  console.log(`⬇ ${entry.name}`);
  console.log(`  → ${entry.url}`);

  // ── Open network request ──────────────────────────
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const totalSize = Number(response.headers.get('content-length') ?? 0);
  const totalLabel = totalSize > 0 ? formatBytes(totalSize) : 'unknown size';

  if (!response.body) {
    throw new Error('Response body is null');
  }

  // ── Stream chunks to disk via Bun FileSink ────────
  const file = Bun.file(filePath);
  const writer = file.writer();
  const reader = response.body.getReader();

  let downloaded = 0;
  const startTime = Date.now();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      writer.write(value);
      downloaded += value.length;

      // Rolling progress — overwrite same line with \r
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? formatBytes(downloaded / elapsed) : '...';
      const pct = totalSize > 0 ? ((downloaded / totalSize) * 100).toFixed(1) : '?';
      process.stdout.write(`\r  ${formatBytes(downloaded)} / ${totalLabel} (${pct}%) @ ${speed}/s`);
    }

    await writer.end();
  } catch (error) {
    // Clean up partial file on failure
    await writer.end();
    try {
      unlinkSync(filePath);
    } catch {
      // Best-effort cleanup
    }
    throw error;
  }

  // ── Final summary ─────────────────────────────────
  const elapsed = (Date.now() - startTime) / 1000;
  const avgSpeed = elapsed > 0 ? formatBytes(downloaded / elapsed) : '...';
  // Clear the rolling progress line and print final status
  process.stdout.write('\n');
  console.log(
    `✓ ${entry.name}  ${formatBytes(downloaded)} in ${elapsed.toFixed(1)}s (${avgSpeed}/s)`,
  );
};

// ── Entry Point ──────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  // Filter out entries with no URL
  const entries = MODELS.filter((m) => m.url !== '');

  if (entries.length === 0) {
    console.log('No models to download.');
    console.log('  Pass a URL: bun run models:download "https://..."');
    console.log('  Or set AIKAMI_DEFAULT_CHECKPOINT_URL env var');
    process.exit(0);
  }

  console.log(`Downloading ${entries.length} model(s)...\n`);

  for (const entry of entries) {
    try {
      await downloadModel(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${entry.name} — ${message}`);
      process.exit(1);
    }
  }

  console.log('\nDone.');
};

main();
