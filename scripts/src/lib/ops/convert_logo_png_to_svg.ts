// scripts/src/lib/ops/convert_logo_png_to_svg.ts
// Converts a raster logo PNG → compact SVG favicon with embedded base64 PNG.
// Replaces the previous imagetracerjs approach which produced ~1.2 MB SVGs.
//
// Usage: bun run scripts/src/lib/ops/convert_logo_png_to_svg.ts [--input <png>] [--output <svg>]

import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const DEFAULT_INPUT = path.join(ROOT, 'assets/logo.png');
const DEFAULT_OUTPUT = path.join(ROOT, 'assets/logo.svg');

/** Target size for the embedded PNG in the SVG. */
const EMBED_SIZE = 128;

const parseArgs = (): { input: string; output: string } => {
  const raw = process.argv.slice(2);
  let input = DEFAULT_INPUT;
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--input' && raw[i + 1]) {
      const nextIndex = i + 1;
      if (raw[nextIndex] !== undefined) {
        input = path.resolve(raw[nextIndex]);
      }
      i++;
    } else if (raw[i] === '--output' && raw[i + 1]) {
      const nextIndex2 = i + 1;
      if (raw[nextIndex2] !== undefined) {
        output = path.resolve(raw[nextIndex2]);
      }
      i++;
    }
  }
  return { input, output };
};

const main = async (): Promise<void> => {
  const { input, output } = parseArgs();

  if (!fs.existsSync(input)) {
    console.error(`Source PNG not found: ${input}`);
    process.exit(1);
  }

  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Resize PNG to favicon-friendly dimensions and encode as base64 data URI
  const pngBuffer = await sharp(input)
    .resize(EMBED_SIZE, EMBED_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const base64 = pngBuffer.toString('base64');
  const mimeType = 'image/png';

  // Minimal SVG wrapper — modern browsers render this as a favicon without issues
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${EMBED_SIZE} ${EMBED_SIZE}">`,
    '  <title>Logo</title>',
    `  <image width="${EMBED_SIZE}" height="${EMBED_SIZE}" href="data:${mimeType};base64,${base64}"/>`,
    '</svg>',
    '',
  ].join('\n');

  fs.writeFileSync(output, svg, 'utf-8');
  console.log(`Logo SVG written to ${output} (${(svg.length / 1024).toFixed(0)} KB)`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
