// apps/frontend/site/scripts/convert_logo_png_to_svg.ts
/** biome-ignore-all lint/suspicious/noAssignInExpressions: Node.js stream processing pattern */
// Converts a raster logo PNG → cropped vector SVG using imagetracerjs.
//
// Usage: bun run scripts/convert_logo_png_to_svg.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

// @ts-expect-error - imagetracerjs has no ESM types
import ImageTracer from 'imagetracerjs';
// @ts-expect-error - internal CLI module, no ESM types
import PNGReader from 'imagetracerjs/nodecli/PNGReader.js';

const REFERENCE_PNG = path.resolve(import.meta.dir, '../src/lib/assets/logo.png');
const OUTPUT_SVG = path.resolve(import.meta.dir, '../src/lib/assets/icons/logo.svg');

const TRACE_OPTIONS = {
  ltres: 1,
  qtres: 1,
  pathomit: 4,
  colorsampling: 2,
  numberofcolors: 16,
  mincolorratio: 0.02,
  colorquantcycles: 3,
  layering: 0,
  strokewidth: 0,
  linefilter: true,
  scale: 1,
  roundcoords: 2,
  viewbox: true,
  desc: false,
  lcpr: 0,
  qcpr: 0,
  blurradius: 0,
  blurdelta: 0,
} as const;

/**
 * Compute content bounding box from visible path coordinates.
 * Skips paths with opacity="0" (usually a full-canvas background filler).
 */
const computeContentBBox = (
  svg: string,
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const pathRegex = /<path([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(svg)) !== null) {
    const attrs = match[1];
    if (attrs === undefined) {
      continue;
    }
    if (attrs.includes('opacity="0"')) {
      continue;
    }

    const dMatch = attrs.match(/d="([^"]+)"/);
    if (!dMatch || dMatch[1] === undefined) {
      continue;
    }

    const nums = dMatch[1].match(/[-]?\d+\.?\d*/g);
    if (!nums) {
      continue;
    }

    const coords = nums.map(Number);
    for (let i = 0; i < coords.length - 1; i += 2) {
      const x = coords[i];
      const y = coords[i + 1];
      if (x === undefined || y === undefined) {
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }

  return { minX, minY, maxX, maxY };
};

/**
 * Crop SVG viewBox to content + padding, removing dead canvas space.
 */
const cropSvgToContent = (svg: string): string => {
  const bbox = computeContentBBox(svg);
  const pad = 30;
  const vbx = Math.round(bbox.minX - pad);
  const vby = Math.round(bbox.minY - pad);
  const vbw = Math.round(bbox.maxX - bbox.minX + pad * 2);
  const vbh = Math.round(bbox.maxY - bbox.minY + pad * 2);

  return svg.replace(/viewBox="[^"]*"/, `viewBox="${vbx} ${vby} ${vbw} ${vbh}"`);
};

const main = async (): Promise<void> => {
  const outDir = path.dirname(OUTPUT_SVG);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (!fs.existsSync(REFERENCE_PNG)) {
    console.error(`Source PNG not found: ${REFERENCE_PNG}`);
    console.error('Place a logo PNG at src/lib/assets/logo.png before running this script.');
    process.exit(1);
  }

  const bytes = fs.readFileSync(REFERENCE_PNG);

  const reader = new PNGReader(bytes);

  reader.parse((err: Error | null, png: { width: number; height: number; pixels: Uint8Array }) => {
    if (err) {
      console.error('PNG parse error:', err);
      process.exit(1);
    }

    const imageData = {
      width: png.width,
      height: png.height,
      data: new Uint8ClampedArray(png.pixels.buffer, png.pixels.byteOffset, png.pixels.byteLength),
    };
    let svgString = ImageTracer.imagedataToSVG(imageData, TRACE_OPTIONS);
    svgString = svgString.trim();

    svgString = cropSvgToContent(svgString);

    if (!svgString.startsWith('<?xml')) {
      svgString = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
    }
    svgString += '\n';

    fs.writeFileSync(OUTPUT_SVG, svgString, 'utf-8');
    console.log(`Logo SVG written to ${OUTPUT_SVG}`);
  });
};

main();
