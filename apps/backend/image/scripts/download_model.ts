// apps/backend/image/scripts/download_model.ts
// Download ComfyUI model checkpoints to apps/backend/image/src/models/.
//
// Usage:
//   bun run scripts/download_model.ts          # download default (SD 1.5)
//   bun run scripts/download_model.ts <url>    # download from custom URL
//   bun run scripts/download_model.ts --list   # list available models
//
// Output directory: apps/backend/image/src/models/checkpoints/

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MODELS_DIR = resolve(
  import.meta.dirname,
  '../src/models/checkpoints',
);

/** Well-known lightweight models for quick testing. */
const KNOWN_MODELS = {
  'sd15': {
    url: 'https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.ckpt',
    filename: 'v1-5-pruned-emaonly.ckpt',
    description: 'Stable Diffusion 1.5 (pruned, ~4.3 GB) — fast, reliable baseline',
  },
} as const;

type KnownModelKey = keyof typeof KNOWN_MODELS;

/**
 * Download a file with progress reporting.
 */
const downloadFile = async (options: {
  url: string;
  dest: string;
  filename: string;
}): Promise<void> => {
  const { url, dest, filename } = options;
  const filePath = resolve(dest, filename);

  mkdirSync(dest, { recursive: true });

  if (existsSync(filePath)) {
    const stat = Bun.file(filePath);
    if (await stat.exists()) {
      const sizeMB = ((stat.size ?? 0) / (1024 * 1024)).toFixed(0);
      console.log(`✓ Already downloaded: ${filename} (${sizeMB} MB)`);
      return;
    }
  }

  console.log(`📥 Downloading: ${filename}`);
  console.log(`   From: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const totalSize = Number(response.headers.get('content-length') ?? 0);
  const totalMB = (totalSize / (1024 * 1024)).toFixed(0);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is null');
  }

  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  let lastReport = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    downloaded += value.length;

    // Report progress every 2 seconds
    const now = Date.now();
    if (now - lastReport > 2000) {
      const pct = totalSize > 0 ? ((downloaded / totalSize) * 100).toFixed(1) : '?';
      const downloadedMB = (downloaded / (1024 * 1024)).toFixed(0);
      console.log(`   ${downloadedMB} MB / ${totalMB} MB (${pct}%)`);
      lastReport = now;
    }
  }

  const buffer = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  await Bun.write(filePath, buffer);
  const finalMB = (downloaded / (1024 * 1024)).toFixed(0);
  console.log(`✓ Downloaded: ${filename} (${finalMB} MB)`);
  console.log(`   Saved to: ${filePath}`);
};

/**
 * List known downloadable models.
 */
const listModels = (): void => {
  console.log('Available models:\n');
  for (const [key, model] of Object.entries(KNOWN_MODELS)) {
    console.log(`  ${key.padEnd(8)} ${model.description}`);
  }
  console.log('\nUsage: bun run download:model <key|url>');
  console.log('  e.g.  bun run download:model sd15');
  console.log('  e.g.  bun run download:model https://example.com/model.safetensors');
};

/**
 * Parse CLI arguments and download the requested model.
 */
const main = async (): Promise<void> => {
  const arg = process.argv[2];

  if (!arg || arg === '--help' || arg === '-h') {
    console.log('ComfyUI Model Downloader\n');
    listModels();
    process.exit(0);
  }

  if (arg === '--list') {
    listModels();
    process.exit(0);
  }

  // Check if it's a known model key
  if (arg in KNOWN_MODELS) {
    const model = KNOWN_MODELS[arg as KnownModelKey];
    await downloadFile({
      url: model.url,
      dest: MODELS_DIR,
      filename: model.filename,
    });
  } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
    // Custom URL — derive filename from URL
    const filename = arg.split('/').pop() ?? 'model.safetensors';
    await downloadFile({
      url: arg,
      dest: MODELS_DIR,
      filename,
    });
  } else {
    console.error(`Unknown model: "${arg}"`);
    console.error('Run with --list to see available models, or pass a URL.');
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
