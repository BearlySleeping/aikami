// scripts/src/lib/ops/convert_image_to_svg.ts
// Converts a raster image (PNG or WebP) → compact SVG with embedded base64 PNG.
// Replaces the previous imagetracerjs approach which produced ~1.2 MB SVGs.
//
// Usage: bun run scripts/src/lib/ops/convert_image_to_svg.ts [--input <png|webp>] [--output <svg>] [--size <n>]

import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { parseCliArgs } from '../cli_utils';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const DEFAULT_INPUT = path.join(ROOT, 'assets/default.webp');
const DEFAULT_OUTPUT = path.join(ROOT, 'assets/default.svg');

/** Target size for the embedded PNG in the SVG. */
const EMBED_SIZE = 128;

const main = async (): Promise<void> => {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    input: { type: 'string' },
    output: { type: 'string' },
    size: { type: 'string' },
  });

  const input = opts.input ? path.resolve(opts.input) : DEFAULT_INPUT;
  const output = opts.output ? path.resolve(opts.output) : DEFAULT_OUTPUT;
  const embedSize = opts.size ? Number.parseInt(opts.size, 10) : EMBED_SIZE;

  if (!fs.existsSync(input)) {
    console.error(`Source image not found: ${input}`);
    process.exit(1);
  }

  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Resize to favicon-friendly dimensions and encode as base64 data URI
  const pngBuffer = await sharp(input)
    .resize(embedSize, embedSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const base64 = pngBuffer.toString('base64');

  // Minimal SVG wrapper — modern browsers render this as a favicon without issues
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${embedSize} ${embedSize}">`,
    '  <title>Logo</title>',
    `  <image width="${embedSize}" height="${embedSize}" href="data:image/png;base64,${base64}"/>`,
    '</svg>',
    '',
  ].join('\n');

  fs.writeFileSync(output, svg, 'utf-8');
  console.log(`SVG written to ${output} (${(svg.length / 1024).toFixed(0)} KB)`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
