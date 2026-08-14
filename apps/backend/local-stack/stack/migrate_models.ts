// apps/backend/local-stack/stack/migrate_models.ts
// biome-ignore-all lint/suspicious/noConsole: standalone CLI script — the console output is the product
//
// One-time model-store migration for C-392. The dev engine services now use
// the shared `aikami-models` store (named volume, or the MODELS_PATH bind
// override) instead of per-service directories:
//
//   Retired:   apps/backend/image/src/models/   (ComfyUI checkpoints)
//              apps/backend/text/src/cache/ollama/  (Ollama blobs)
//   Replaced by: the aikami-models volume from C-390 (or MODELS_PATH)
//
// This script COPIES (never moves) ComfyUI checkpoints from
// apps/backend/image/src/models/ into the shared store, preserving relative
// paths under <store>/image/. The originals are left in place.
//
// Ollama blobs in text/src/cache/ollama/ are content-addressed and are NOT
// reusable as GGUF files — copying them into the new store would silently
// produce a broken model path. They are left untouched and remain usable
// only via the opt-in `text-ollama` service, which this script states
// plainly in its output.
//
// Safe to re-run: the copy is idempotent and a partial copy is corrected by
// re-running.
//
// Usage:
//   bun stack/migrate_models.ts                          # MODELS_PATH or aikami-models volume
//   MODELS_PATH=/path/to/models bun stack/migrate_models.ts
//   bun stack/migrate_models.ts --dest /tmp/store        # explicit destination
//   bun stack/migrate_models.ts --source <dir> --ollama <dir>

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

/** Weight file extensions copied from the ComfyUI tree. */
export const MODEL_WEIGHT_EXTENSIONS = [
  '.safetensors',
  '.ckpt',
  '.pt',
  '.pth',
  '.gguf',
  '.bin',
] as const;

/** True when a file name looks like a model weight. */
export const isWeightFile = (name: string): boolean =>
  MODEL_WEIGHT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/** Recursively list every file under a directory. */
const walkFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

export type MigratedFile = {
  from: string;
  to: string;
  bytes: number;
};

export type MigrateResult = {
  /** Destination store root (the directory that receives <store>/image/…). */
  destDir: string;
  copied: MigratedFile[];
  /** ComfyUI source directory scanned (may not exist on fresh clones). */
  comfyuiScanned: string;
  /** Ollama directory checked (may not exist). */
  ollamaDir: string | undefined;
  /** Number of files found in the Ollama tree (left untouched). */
  ollamaFilesFound: number;
};

/**
 * Copies ComfyUI checkpoint weights into the shared model store.
 *
 * @param options — comfyuiDir source tree, destDir store root, ollamaDir to
 *                  scan-and-report (never touched).
 * @returns A summary of what was copied and what was left alone.
 */
export const migrateModels = async (options: {
  comfyuiDir: string;
  destDir: string;
  ollamaDir?: string;
}): Promise<MigrateResult> => {
  const { comfyuiDir, destDir, ollamaDir } = options;
  const copied: MigratedFile[] = [];

  if (existsSync(comfyuiDir)) {
    for (const file of await walkFiles(comfyuiDir)) {
      if (!isWeightFile(file)) {
        continue;
      }
      const rel = relative(comfyuiDir, file);
      const to = join(destDir, 'image', rel);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(file, to);
      copied.push({ from: file, to, bytes: (await stat(file)).size });
    }
  }

  let ollamaFilesFound = 0;
  if (ollamaDir && existsSync(ollamaDir)) {
    ollamaFilesFound = (await walkFiles(ollamaDir)).length;
  }

  return {
    destDir,
    copied,
    comfyuiScanned: comfyuiDir,
    ollamaDir,
    ollamaFilesFound,
  };
};

/** Format bytes into a human-readable string. */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)}KB`;
  }
  const mb = kb / 1024;
  return mb >= 1000 ? `${(mb / 1024).toFixed(2)}GB` : `${mb.toFixed(1)}MB`;
};

const printSummary = (result: MigrateResult, destLabel: string): void => {
  console.log(
    `\n✓ ${result.copied.length} ComfyUI checkpoint(s) copied into the shared model store`,
  );
  for (const file of result.copied) {
    console.log(`    • ${relative(result.destDir, file.to)}  (${formatBytes(file.bytes)})`);
  }
  console.log(`  Destination: ${destLabel}`);
  console.log('  Originals left in place — nothing was deleted.');

  if (result.ollamaFilesFound > 0) {
    console.log(
      `\n○ ${result.ollamaFilesFound} file(s) in ${result.ollamaDir ?? 'the Ollama tree'} were left untouched.`,
    );
  }
  console.log(
    '\nOllama models (text/src/cache/ollama/) remain usable only via the opt-in service:\n' +
      '    bun herdr:start text-ollama\n' +
      'Ollama stores blobs in a content-addressed layout, not as GGUF files — they cannot\n' +
      'be handed to llama-server. The default `text` service fetches its GGUF fresh from\n' +
      'the C-390 model manifest:\n' +
      '    cd apps/backend/local-stack && bun run fetch-models\n',
  );
};

/**
 * Copy a staging tree into the docker `aikami-models` named volume via a
 * throwaway container. The volume is created on demand by docker.
 */
const dockerCopyIntoVolume = async (stagingDir: string, volumeName: string): Promise<void> => {
  const child = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '-v',
      `${volumeName}:/models`,
      '-v',
      `${stagingDir}:/import:ro`,
      'alpine',
      'sh',
      '-c',
      'mkdir -p /models && cp -a /import/. /models/',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`docker copy into ${volumeName} failed with exit ${code}`);
  }
};

/**
 * Runs the migration CLI.
 *
 * @returns Process exit code.
 */
export const run = async (options: {
  comfyuiDir?: string;
  ollamaDir?: string;
  destDir?: string;
}): Promise<number> => {
  const repoRoot = resolve(import.meta.dir, '../../../..');
  const comfyuiDir = options.comfyuiDir ?? resolve(repoRoot, 'apps/backend/image/src/models');
  const ollamaDir = options.ollamaDir ?? resolve(repoRoot, 'apps/backend/text/src/cache/ollama');
  const destDir = options.destDir ?? process.env.MODELS_PATH;

  console.log('Migrating ComfyUI checkpoints into the shared model store (C-392)…');
  console.log(`  Source: ${comfyuiDir}`);

  if (!destDir) {
    // No MODELS_PATH → copy into the docker `aikami-models` named volume via
    // a staging dir (the volume cannot be written directly from the host).
    const staging = await mkdtemp(join(tmpdir(), 'aikami-migrate-'));
    try {
      const result = await migrateModels({ comfyuiDir, destDir: staging, ollamaDir });
      if (result.copied.length === 0) {
        console.log('\n○ Nothing to migrate — no ComfyUI checkpoints found.');
        printSummary(result, 'aikami-models named volume');
        return 0;
      }
      await dockerCopyIntoVolume(staging, 'aikami-models');
      printSummary(result, 'aikami-models named volume');
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } else {
    const result = await migrateModels({ comfyuiDir, destDir, ollamaDir });
    if (result.copied.length === 0) {
      console.log('\n○ Nothing to migrate — no ComfyUI checkpoints found.');
    }
    printSummary(result, `MODELS_PATH=${destDir}`);
  }

  return 0;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const argOf = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? (args[idx + 1] as string | undefined) : undefined;
  };
  const dest = argOf('--dest') ?? process.env.MODELS_PATH;
  process.exit(
    await run({
      comfyuiDir: argOf('--source'),
      ollamaDir: argOf('--ollama'),
      destDir: dest,
    }),
  );
}
