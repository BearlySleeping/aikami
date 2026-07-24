// apps/backend/text/scripts/download_model.ts
// Downloads the recommended GGUF model for Shimmy inference.
// Default: Llama-3.2-3B-Instruct Q4_K_M (~2.0 GB, ~2.5 GB VRAM at 2K ctx).
//
// Usage:
//   bun run scripts/download_model.ts              # default model
//   bun run scripts/download_model.ts --list       # list available models

import { readFileSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');

// ── Recommended model ──────────────────────────────────────

const DEFAULT_MODEL = {
  name: 'llama-3.2-3b-instruct',
  url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  size: '1.9 GB',
} as const;

/** Lightweight model — fits in 1 GB VRAM, fast on CPU. */
const TINY_MODEL = {
  name: 'tinyllama-1.1b',
  url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_0.gguf',
  file: 'tinyllama-1.1b-chat-v1.0.Q4_0.gguf',
  size: '638 MB',
} as const;

const MODELS_DIR = resolve(PROJECT_DIR, 'src/cache/models');
const SHIMMY_PORT = 11435;
const SHIMMY_URL = `http://localhost:${SHIMMY_PORT}`;

// ── Types ──────────────────────────────────────────────────

type ModelEntry = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

type ModelsResponse = {
  object: string;
  data: ModelEntry[];
};

// ── Helpers ─────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/**
 * Download a file via streaming fetch with progress reporting.
 */
const downloadFile = async (options: {
  url: string;
  dest: string;
}): Promise<void> => {
  const { url, dest } = options;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(600_000), // 10 min for 2 GB
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (!response.body) {
    throw new Error('Response has no body');
  }

  const reader = response.body.getReader();
  const stream = createWriteStream(dest);
  const startTime = Date.now();
  let downloaded = 0;
  let lastReport = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      stream.write(Buffer.from(value));
      downloaded += value.length;

      // Report every 500ms
      const now = Date.now();
      if (now - lastReport >= 500) {
        const elapsed = (now - startTime) / 1000;
        const speed = elapsed > 0 ? formatBytes(downloaded / elapsed) : '...';
        const pct = contentLength > 0
          ? `${((downloaded / contentLength) * 100).toFixed(0)}%`
          : '';
        process.stdout.write(
          `\r  ${formatBytes(downloaded)}${contentLength > 0 ? ` / ${formatBytes(contentLength)}` : ''} ${pct} @ ${speed}/s`,
        );
        lastReport = now;
      }
    }
  } finally {
    reader.releaseLock();
    stream.end();
  }

  const elapsed = (Date.now() - startTime) / 1000;
  process.stdout.write('\n');
  console.log(`  ✓ Downloaded ${formatBytes(downloaded)} in ${elapsed.toFixed(1)}s`);
};

// ── Model listing ───────────────────────────────────────────

const listModels = async (): Promise<ModelEntry[]> => {
  const response = await fetch(`${SHIMMY_URL}/v1/models`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = (await response.json()) as ModelsResponse;
  return data.data ?? [];
};

// ── Entry Point ─────────────────────────────────────────────

const main = async (): Promise<void> => {
  const listOnly = Bun.argv.includes('--list');

  if (listOnly) {
    // Just list what's available
    console.log('\n  Shimmy — Available Models\n');
    try {
      const models = await listModels();
      console.log(`  ${models.length} model(s):\n`);
      for (const model of models) {
        const destPath = resolve(MODELS_DIR, `${model.id}.gguf`);
        const size = existsSync(destPath)
          ? formatBytes(statSync(destPath).size)
          : '(not downloaded)';
        console.log(`    • ${model.id}  ${size}`);
      }
    } catch {
      console.log('  Shimmy is not running.');
      console.log('  Start with: bun herdr:start text');
    }
    console.log('');
    return;
  }

  // ── Download ──────────────────────────────────
  const useTiny = Bun.argv.includes('--tiny');
  const model = useTiny ? TINY_MODEL : DEFAULT_MODEL;
  const destPath = resolve(MODELS_DIR, model.file);

  await Bun.$`mkdir -p ${MODELS_DIR}`.cwd(PROJECT_DIR).quiet();

  // Check if already downloaded
  if (existsSync(destPath)) {
    const size = formatBytes(statSync(destPath).size);
    console.log(`○ ${model.file} already exists (${size})`);
    console.log('  Delete it to re-download.');
    process.exit(0);
  }

  console.log(`\n⬇  Downloading ${model.name} (${model.size})...`);
  console.log(`   ${model.url.split('/').slice(0, 3).join('/')}/...`);

  try {
    await downloadFile({ url: model.url, dest: destPath });
    console.log(`\n✓ Model saved to src/cache/models/${model.file}`);
    console.log('  Restart Shimmy to load it: bun herdr:restart text');
  } catch (error) {
    // Clean up partial download
    if (existsSync(destPath)) {
      await Bun.$`rm -f ${destPath}`.quiet();
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Download failed: ${message}`);
    process.exit(1);
  }

  console.log('');
};

main();
