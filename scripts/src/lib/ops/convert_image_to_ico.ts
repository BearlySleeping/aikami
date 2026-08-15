// scripts/src/lib/ops/convert_image_to_ico.ts
// Converts a raster image (PNG or WebP) → multi-size favicon .ico (16, 32, 48).
// Modeled on the favicon.ico logic in generate_brand_assets.ts.
//
// Usage: bun run scripts/src/lib/ops/convert_image_to_ico.ts [--input <png|webp>] [--output <ico>] [--sizes 16,32,48]

import * as fs from 'node:fs';
import * as path from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';
import { parseCliArgs } from '../cli_utils';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const DEFAULT_INPUT = path.join(ROOT, 'assets/default.webp');
const DEFAULT_OUTPUT = path.join(ROOT, 'assets/default.ico');
const DEFAULT_SIZES = [16, 32, 48];

const main = async (): Promise<void> => {
  const opts = parseCliArgs(Bun.argv.slice(2), {
    input: { type: 'string' },
    output: { type: 'string' },
    sizes: { type: 'string' },
  });

  const input = opts.input ? path.resolve(opts.input) : DEFAULT_INPUT;
  const output = opts.output ? path.resolve(opts.output) : DEFAULT_OUTPUT;
  const sizes = opts.sizes
    ? opts.sizes
        .split(',')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => !Number.isNaN(n) && n > 0)
    : DEFAULT_SIZES;
  if (sizes.length === 0) {
    console.error(
      'No valid sizes given (--sizes expects comma-separated positive ints, e.g. 16,32,48)',
    );
    process.exit(1);
  }

  if (!fs.existsSync(input)) {
    console.error(`Source image not found: ${input}`);
    process.exit(1);
  }

  const outDir = path.dirname(output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Rasterize each size, then pack them into a multi-size ICO
  const pngBuffers = await Promise.all(
    sizes.map((s) =>
      sharp(input)
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  );

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(output, icoBuffer);
  console.log(
    `ICO written to ${output} (${(icoBuffer.length / 1024).toFixed(1)} KB, sizes: ${sizes.join('+')})`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
