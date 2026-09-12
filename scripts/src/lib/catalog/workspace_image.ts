// scripts/src/lib/catalog/workspace_image.ts
import sharp from 'sharp';
import { logger } from '$logger';
import {
  atomicWrite,
  digestBytes,
  jsonBytes,
  readOptional,
  workspacePath,
} from './workspace_files.ts';

/** Produce an offline checkerboard preview and alpha audit without altering source bytes. */
export const inspectWorkspaceImage = async (options: { root: string; input: string }) => {
  logger.debug('inspectWorkspaceImage', { input: options.input });
  const bytes = await readOptional(
    await workspacePath({ root: options.root, path: `working/${options.input}` }),
  );
  if (!bytes || bytes.length > 64 * 1024 * 1024) {
    throw new Error('Missing image or input exceeds 64 MiB');
  }
  const image = sharp(bytes, { limitInputPixels: 16_777_216 });
  const metadata = await image.metadata();
  if (
    !['png', 'webp'].includes(metadata.format ?? '') ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.width ||
    !metadata.height
  ) {
    throw new Error('Expected a single-frame PNG/WebP');
  }
  const { width, height } = metadata;
  const pixels = await image.clone().ensureAlpha().raw().toBuffer();
  let transparentPixels = 0;
  let partialAlphaPixels = 0;
  const board = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const alpha = pixels[pixel * 4 + 3];
    if (alpha === 0) {
      transparentPixels++;
    } else if (alpha !== undefined && alpha < 255) {
      partialAlphaPixels++;
    }
    const gray =
      (Math.floor((pixel % width) / 8) + Math.floor(pixel / width / 8)) % 2 === 0 ? 64 : 192;
    board.fill(gray, pixel * 3, pixel * 3 + 3);
  }
  const hash = digestBytes(bytes);
  const preview = `previews/${hash}_checker.png`;
  const rendered = await sharp(board, { raw: { width, height, channels: 3 } })
    .composite([{ input: Buffer.from(bytes) }])
    .png()
    .toBuffer();
  await atomicWrite({ root: options.root, path: preview, bytes: rendered });
  const report = {
    input: options.input,
    hash,
    width,
    height,
    sizeBytes: bytes.length,
    hasAlpha: metadata.hasAlpha === true,
    transparentPixels,
    partialAlphaPixels,
    preview,
  };
  await atomicWrite({
    root: options.root,
    path: `previews/${hash}.json`,
    bytes: jsonBytes(report),
  });
  return report;
};

/** Preserve pixel-art color and alpha exactly; never key out green or guess sprite geometry. */
export const optimizeWorkspaceImage = async (options: {
  root: string;
  input: string;
  output: string;
  kind: 'prop' | 'terrain' | 'portrait';
}): Promise<{
  inputBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  hasTransparency: boolean;
  hash: string;
}> => {
  logger.debug('optimizeWorkspaceImage', { input: options.input, output: options.output });
  if (!options.output.endsWith('.webp') || !options.output.startsWith('game-data/')) {
    throw new Error('Output must be a game-data/...webp path inside working/.');
  }
  const bytes = await readOptional(
    await workspacePath({ root: options.root, path: `imports/${options.input}` }),
  );
  if (!bytes || bytes.length > 64 * 1024 * 1024) {
    throw new Error('Missing image or input exceeds 64 MiB. Put originals in imports/.');
  }
  const image = sharp(bytes, { limitInputPixels: 16_777_216 });
  const metadata = await image.metadata();
  if (
    !['png', 'webp'].includes(metadata.format ?? '') ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.width ||
    !metadata.height
  ) {
    throw new Error('Expected a single-frame PNG/WebP with valid dimensions.');
  }
  const statistics = await image.stats();
  const hasTransparency = metadata.hasAlpha === true && !statistics.isOpaque;
  if (options.kind === 'prop' && !hasTransparency) {
    throw new Error('Prop is opaque. Supply real alpha—not a green or checkerboard background.');
  }
  const encoded = await image.webp({ lossless: true, effort: 6 }).toBuffer();
  const decoded = sharp(encoded);
  // Compare visible color/alpha, not hidden RGB in fully transparent pixels (WebP may discard it).
  const before = await image.clone().ensureAlpha().raw().toBuffer();
  const after = await decoded.clone().ensureAlpha().raw().toBuffer();
  if (before.length !== after.length) {
    throw new Error('Optimization changed image dimensions/channels');
  }
  for (let index = 0; index < before.length; index += 4) {
    if (
      before[index + 3] !== after[index + 3] ||
      (before[index + 3] !== 0 &&
        (before[index] !== after[index] ||
          before[index + 1] !== after[index + 1] ||
          before[index + 2] !== after[index + 2]))
    ) {
      throw new Error('Lossless optimization changed visible pixels or alpha');
    }
  }
  const target = `working/${options.output}`;
  const existing = await readOptional(await workspacePath({ root: options.root, path: target }));
  if (existing && digestBytes(existing) !== digestBytes(encoded)) {
    throw new Error(
      'Output already exists with different bytes. Choose a new name or move it aside.',
    );
  }
  await atomicWrite({ root: options.root, path: target, bytes: encoded });
  return {
    inputBytes: bytes.length,
    outputBytes: encoded.length,
    width: metadata.width,
    height: metadata.height,
    hasTransparency,
    hash: digestBytes(encoded),
  };
};
