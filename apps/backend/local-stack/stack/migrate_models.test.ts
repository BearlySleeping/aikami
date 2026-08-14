// apps/backend/local-stack/stack/migrate_models.test.ts
//
// C-392 AC-8: the migration copies ComfyUI checkpoints into the shared model
// store and leaves the originals in place; Ollama blobs are untouched. Uses
// a fixture tree so the test never touches a real model directory.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWeightFile, migrateModels } from './migrate_models.ts';

const makeFixtureTree = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'aikami-migrate-test-'));
  // ComfyUI checkpoint tree (plain safetensors — copyable).
  await mkdir(join(root, 'comfyui', 'checkpoints', 'pixel-art'), { recursive: true });
  await writeFile(join(root, 'comfyui', 'checkpoints', 'pixel-art', 'art.safetensors'), 'ckpt');
  await writeFile(join(root, 'comfyui', 'checkpoints', 'v1-5-pruned-emaonly.ckpt'), 'sd15');
  await mkdir(join(root, 'comfyui', 'loras'), { recursive: true });
  await writeFile(join(root, 'comfyui', 'loras', 'style.safetensors'), 'lora');
  await writeFile(join(root, 'comfyui', 'README.md'), 'not a weight');
  // Ollama content-addressed blob store — NOT copyable as GGUF.
  await mkdir(join(root, 'ollama', 'blobs'), { recursive: true });
  await writeFile(join(root, 'ollama', 'blobs', 'sha256-abcdef'), 'blob');
  await mkdir(join(root, 'ollama', 'manifests'), { recursive: true });
  await writeFile(join(root, 'ollama', 'manifests', 'qwen3.5'), 'manifest');
  return root;
};

describe('isWeightFile', () => {
  test('recognises model weight extensions', () => {
    expect(isWeightFile('model.safetensors')).toBe(true);
    expect(isWeightFile('model.ckpt')).toBe(true);
    expect(isWeightFile('model.gguf')).toBe(true);
    expect(isWeightFile('model.bin')).toBe(true);
    expect(isWeightFile('model.pth')).toBe(true);
  });

  test('rejects non-weight files', () => {
    expect(isWeightFile('README.md')).toBe(false);
    expect(isWeightFile('config.yaml')).toBe(false);
    expect(isWeightFile('model.safetensors.bak')).toBe(false);
  });
});

describe('C-392 AC-8 — migrate_models copies ComfyUI checkpoints into the shared store', () => {
  test('copies weights, preserves relative paths, and leaves originals intact', async () => {
    const root = await makeFixtureTree();
    try {
      const comfyui = join(root, 'comfyui');
      const ollama = join(root, 'ollama');
      const dest = join(root, 'store');

      const result = await migrateModels({ comfyuiDir: comfyui, destDir: dest, ollamaDir: ollama });

      // 3 weights copied (2 checkpoints + 1 lora), README skipped.
      expect(result.copied).toHaveLength(3);
      expect(existsSync(join(dest, 'image', 'checkpoints', 'pixel-art', 'art.safetensors'))).toBe(
        true,
      );
      expect(existsSync(join(dest, 'image', 'checkpoints', 'v1-5-pruned-emaonly.ckpt'))).toBe(true);
      expect(existsSync(join(dest, 'image', 'loras', 'style.safetensors'))).toBe(true);
      expect(existsSync(join(dest, 'image', 'README.md'))).toBe(false);

      // Originals remain in place — nothing was moved or deleted.
      expect(existsSync(join(comfyui, 'checkpoints', 'pixel-art', 'art.safetensors'))).toBe(true);
      expect(existsSync(join(comfyui, 'README.md'))).toBe(true);

      // Content matches.
      expect(readFileSync(join(dest, 'image', 'loras', 'style.safetensors'), 'utf8')).toBe('lora');

      // Ollama tree untouched and reported.
      expect(existsSync(join(ollama, 'blobs', 'sha256-abcdef'))).toBe(true);
      expect(existsSync(join(ollama, 'manifests', 'qwen3.5'))).toBe(true);
      expect(result.ollamaFilesFound).toBe(2);
      expect(result.ollamaDir).toBe(ollama);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('is idempotent — re-running overwrites without error', async () => {
    const root = await makeFixtureTree();
    try {
      const comfyui = join(root, 'comfyui');
      const dest = join(root, 'store');

      const first = await migrateModels({ comfyuiDir: comfyui, destDir: dest });
      expect(first.copied).toHaveLength(3);

      const second = await migrateModels({ comfyuiDir: comfyui, destDir: dest });
      expect(second.copied).toHaveLength(3);
      expect(existsSync(join(dest, 'image', 'checkpoints', 'pixel-art', 'art.safetensors'))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('tolerates a missing source tree (fresh clone)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aikami-migrate-missing-'));
    try {
      const result = await migrateModels({
        comfyuiDir: join(root, 'does-not-exist'),
        destDir: join(root, 'store'),
      });
      expect(result.copied).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('copies into <dest>/image/ so the sd-server store layout is preserved', async () => {
    const root = await makeFixtureTree();
    try {
      const comfyui = join(root, 'comfyui');
      const dest = join(root, 'store');
      const result = await migrateModels({ comfyuiDir: comfyui, destDir: dest });
      for (const file of result.copied) {
        expect(file.to.startsWith(join(dest, 'image'))).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
