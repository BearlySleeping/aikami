// .pi/extensions/lib/image_preparation.test.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { prepareImageDataUri } from './image_preparation.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const originalBytes = Buffer.from('original evidence bytes');
const optimizedBytes = Buffer.from('lossy optimized bytes');

let directory: string;
let filepath: string;
let copies: string[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aikami-image-test-'));
  filepath = join(directory, 'montage.png');
  copies = [];
  await writeFile(filepath, originalBytes);
});

afterEach(async () => {
  try {
    expect(digest(await readFile(filepath))).toBe(digest(originalBytes));
    for (const copy of copies) {
      expect(existsSync(dirname(copy))).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const optimizeImage = async (copy: string) => {
  copies.push(copy);
  expect(copy).not.toBe(filepath);
  expect(extname(copy)).toBe(extname(filepath));
  expect(await readFile(copy)).toEqual(originalBytes);
  await writeFile(copy, optimizedBytes);
};

const encodeImage = async (copy: string) => {
  expect(copies).toContain(copy);
  expect(await readFile(copy)).toEqual(optimizedBytes);
  return `data:image/png;base64,${(await readFile(copy)).toString('base64')}`;
};

describe('prepareImageDataUri', () => {
  test('encodes optimized bytes while preserving the original checksum', async () => {
    expect(await prepareImageDataUri({ filepath, optimizeImage, encodeImage })).toBe(
      `data:image/png;base64,${optimizedBytes.toString('base64')}`,
    );
    expect(copies).toHaveLength(1);
  });

  test('preserves WebP extension on the disposable copy', async () => {
    filepath = join(directory, 'capture.webp');
    await writeFile(filepath, originalBytes);
    await prepareImageDataUri({ filepath, optimizeImage, encodeImage });
    expect(copies).toHaveLength(1);
  });

  test('cleans up after an optimizer writes then fails, without encoding', async () => {
    let encoded = false;
    await expect(
      prepareImageDataUri({
        filepath,
        optimizeImage: async (copy) => {
          await optimizeImage(copy);
          throw new Error('optimizer failed');
        },
        encodeImage: async () => {
          encoded = true;
          return 'unexpected';
        },
      }),
    ).rejects.toThrow('optimizer failed');
    expect(encoded).toBe(false);
    expect(copies).toHaveLength(1);
  });

  test('cleans up when encoding fails', async () => {
    await expect(
      prepareImageDataUri({
        filepath,
        optimizeImage,
        encodeImage: async () => {
          throw new Error('encoder failed');
        },
      }),
    ).rejects.toThrow('encoder failed');
    expect(copies).toHaveLength(1);
  });

  test('does not optimize when already cancelled', async () => {
    await expect(
      prepareImageDataUri({
        filepath,
        signal: AbortSignal.abort(new Error('cancelled')),
        optimizeImage,
        encodeImage,
      }),
    ).rejects.toThrow('cancelled');
    expect(copies).toHaveLength(0);
  });

  test('cleans up after cancellation during optimization and skips encoding', async () => {
    const controller = new AbortController();
    let encoded = false;
    await expect(
      prepareImageDataUri({
        filepath,
        signal: controller.signal,
        optimizeImage: async (copy) => {
          await optimizeImage(copy);
          controller.abort(new Error('cancelled'));
        },
        encodeImage: async () => {
          encoded = true;
          return 'unexpected';
        },
      }),
    ).rejects.toThrow('cancelled');
    expect(encoded).toBe(false);
    expect(copies).toHaveLength(1);
  });

  test('isolates concurrent preparations of the same source', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        prepareImageDataUri({ filepath, optimizeImage, encodeImage }),
      ),
    );
    expect(new Set(copies).size).toBe(3);
    expect(results).toEqual(
      Array.from({ length: 3 }, () => `data:image/png;base64,${optimizedBytes.toString('base64')}`),
    );
  });
});
