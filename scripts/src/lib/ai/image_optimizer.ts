// scripts/src/lib/ai/image_optimizer.ts
// Shared image optimization pipeline for AI vision processing.
//
// Provides Lanczos resampling, PNG8 quantisation, and base64 encoding.
// Used by: e2e visual tests, Pi chrome-devtools extension, scripts/ops.
//
// Contract: C-200 AC-1 (common image optimisation)

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────

/** Options for the Lanczos resample step. */
export type LanczosResizeOptions = {
  /** Target width in pixels. Default: 672. */
  width?: number;
  /** Target height in pixels. Default: same as width (square output). */
  height?: number;
};

/** Options for PNG8 quantisation via ImageMagick. */
export type PngOptimizeOptions = {
  /** Max colour palette size. Default: 256. */
  maxColors?: number;
};

/** Combined optimisation options. */
export type ImageOptimizeOptions = LanczosResizeOptions &
  PngOptimizeOptions & {
    /** Skip Lanczos resize step. Default: false. */
    skipResize?: boolean;
    /** Skip PNG8 quantisation step. Default: false. */
    skipQuantize?: boolean;
  };

/**
 * Target dimensions for Lanczos-resampled visual test images.
 *
 * 672×672 = 21×32 = grid-aligned multiple of 32, which preserves
 * tile-boundary alignment in downsampled sprites. Chosen as a
 * practical size for local Ollama vision models (7B class) that
 * have limited context windows and VRAM budgets.
 *
 * Contract: C-200 AC-1 Visual Pipeline Optimization
 */
export const DEFAULT_LANCZOS_SIZE = 672;

// ── Lanczos resize ────────────────────────────────────────────

/**
 * Resamples a PNG screenshot to target dimensions using Lanczos-3 kernel.
 *
 * Uses sharp (if available) for square stretching — the image is resized
 * to exactly targetWidth × targetHeight regardless of original aspect ratio.
 * Falls back silently if sharp is not installed.
 *
 * The output is always PNG (lossless) — never JPEG or WebP, which
 * introduce compression artifacts that degrade fine edge feature
 * tracking for 2D pixel-art sprites.
 *
 * @throws If the input file does not exist.
 */
export const resizeLanczos = async (options: {
  filepath: string;
  width?: number;
  height?: number;
}): Promise<void> => {
  const { filepath, width = DEFAULT_LANCZOS_SIZE, height = width } = options;

  try {
    // Dynamic import — sharp is an optional peer dependency not declared in package.json
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - sharp is loaded dynamically at runtime
    const sharpModule = await import('sharp');
    const sharp = sharpModule?.default ?? sharpModule;
    if (!sharp || typeof sharp !== 'function') {
      return; // sharp not available — skip
    }

    const input = readFileSync(filepath);
    const resized = await sharp(input)
      .resize(width, height, {
        fit: 'fill',
        kernel: 'lanczos3',
      })
      .png()
      .toBuffer();
    writeFileSync(filepath, resized);
  } catch {
    // sharp not available or resize failed — original PNG is usable
  }
};

// ── PNG8 quantisation ─────────────────────────────────────────

/**
 * Optimises a PNG screenshot using ImageMagick.
 *
 * Strips metadata and reduces to a palette PNG for smaller payloads
 * when sending to AI vision APIs.
 *
 * Falls back silently if ImageMagick `convert` is not on PATH.
 */
export const optimizePng = async (options: {
  filepath: string;
  maxColors?: number;
}): Promise<void> => {
  const { filepath, maxColors = 256 } = options;

  try {
    const { $ } = await import('bun');
    await $`convert ${filepath} -strip -colors ${maxColors} PNG8:${filepath}`.quiet().nothrow();
  } catch {
    // ImageMagick not available — skip optimisation
  }
};

// ── Combined pipeline ─────────────────────────────────────────

/**
 * Full image optimisation pipeline: resize → quantise.
 *
 * Applies Lanczos resample first, then PNG8 palette quantisation.
 * Each step degrades gracefully if its dependency is missing.
 *
 * @returns The optimised filepath (same as input — in-place mutation).
 */
export const optimizeImage = async (options: {
  filepath: string;
  /** Options forwarded to resize + quantise steps. */
  optimize?: ImageOptimizeOptions;
}): Promise<string> => {
  const { filepath, optimize = {} } = options;
  const {
    width = DEFAULT_LANCZOS_SIZE,
    height = width,
    maxColors = 256,
    skipResize = false,
    skipQuantize = false,
  } = optimize;

  if (!skipResize) {
    await resizeLanczos({ filepath, width, height });
  }

  if (!skipQuantize) {
    await optimizePng({ filepath, maxColors });
  }

  return filepath;
};

// ── WebP conversion ───────────────────────────────────────────

/** Options for ImageMagick WebP conversion. */
export type WebpConvertOptions = {
  /** Max dimension (maintains aspect ratio). Default: 800. */
  maxDimension?: number;
  /** WebP quality (0-100). Default: 80. */
  quality?: number;
};

/**
 * Converts a PNG to an optimised WebP via ImageMagick, caching the result.
 *
 * Skips re-encoding if the .webp already exists and is newer than the .png.
 * Falls back to the original PNG path if ImageMagick is unavailable.
 *
 * @returns Absolute path to the WebP file (or PNG fallback).
 */
export const convertToWebp = async (options: {
  pngPath: string;
  convert?: WebpConvertOptions;
}): Promise<string> => {
  const { pngPath, convert = {} } = options;
  const { maxDimension = 800, quality = 80 } = convert;

  const webpPath = pngPath.replace(/\.png$/i, '.webp');

  // Cache: skip if WebP exists and is newer than PNG
  if (existsSync(webpPath)) {
    const pngStat = statSync(pngPath);
    const webpStat = statSync(webpPath);
    if (webpStat.mtimeMs >= pngStat.mtimeMs) {
      return webpPath;
    }
  }

  try {
    const { $ } = await import('bun');
    await $`convert ${pngPath} -resize "${maxDimension}x${maxDimension}>" -quality ${quality} ${webpPath}`.quiet();
  } catch {
    // ImageMagick unavailable — return original PNG
    return pngPath;
  }

  return existsSync(webpPath) ? webpPath : pngPath;
};

// ── Base64 encoding ───────────────────────────────────────────

/**
 * Reads an image file and returns a base64 data URI.
 *
 * Automatically detects MIME type from file extension (.png or .webp).
 *
 * @throws If the file does not exist or cannot be read.
 */
export const toBase64DataUri = (filepath: string): string => {
  const buf = readFileSync(filepath);
  const b64 = buf.toString('base64');
  const ext = filepath.endsWith('.webp') ? 'webp' : 'png';
  return `data:image/${ext};base64,${b64}`;
};

/**
 * Saves a base64-encoded PNG to disk.
 *
 * Automatically creates parent directories. Strips the data URI prefix
 * if present before decoding.
 *
 * @returns The absolute path of the saved file.
 */
export const saveBase64Png = (options: {
  dataUri: string;
  dir: string;
  filename: string;
}): string => {
  const { dataUri, dir, filename } = options;
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, filename);
  const b64 = dataUri.replace(/^data:image\/\w+;base64,/, '');
  writeFileSync(filepath, Buffer.from(b64, 'base64'));
  return filepath;
};
