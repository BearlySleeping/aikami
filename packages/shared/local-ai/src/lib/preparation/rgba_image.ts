// packages/shared/local-ai/src/lib/preparation/rgba_image.ts
//
// C-520: a portable straight-RGBA pixel surface and the deterministic
// primitives the preparation kernel is built from.
//
// Everything here is integer arithmetic on a `Uint8Array`. There is no canvas,
// no `sharp`, no float accumulation left to a library's default — the same
// input buffer produces the same output buffer on every machine, which is what
// makes a prepared SHA-256 a stable identity.
//
// Alpha-aware resampling works in *premultiplied* colour: averaging straight
// RGB against transparent-black neighbours would drag a dark halo into every
// silhouette, which is exactly the alpha fringe this contract has to prevent.
//
// Contract: C-520 Versioned image workflows and asset preparation

/** A straight-alpha RGBA image: 4 bytes per pixel, row-major, top-left origin. */
export type RgbaImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/** A pixel rectangle in image space. */
export type PixelBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Allocates a fully transparent image. */
export const createRgbaImage = (options: { width: number; height: number }): RgbaImage => ({
  width: options.width,
  height: options.height,
  data: new Uint8Array(options.width * options.height * 4),
});

/** Deep-copies an image. */
export const cloneRgbaImage = (image: RgbaImage): RgbaImage => ({
  width: image.width,
  height: image.height,
  data: new Uint8Array(image.data),
});

/** True when the coordinates address a pixel inside the image. */
export const isInside = (image: RgbaImage, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < image.width && y < image.height;

/** Reads the alpha channel at a coordinate; out-of-bounds reads are transparent. */
export const alphaAt = (image: RgbaImage, x: number, y: number): number =>
  isInside(image, x, y) ? (image.data[(y * image.width + x) * 4 + 3] ?? 0) : 0;

/** Writes one RGBA pixel; out-of-bounds writes are dropped. */
export const setPixel = (
  image: RgbaImage,
  x: number,
  y: number,
  pixel: { r: number; g: number; b: number; a: number },
): void => {
  if (!isInside(image, x, y)) {
    return;
  }
  const offset = (y * image.width + x) * 4;
  image.data[offset] = pixel.r;
  image.data[offset + 1] = pixel.g;
  image.data[offset + 2] = pixel.b;
  image.data[offset + 3] = pixel.a;
};

/** Reads one RGBA pixel; out-of-bounds reads return fully transparent black. */
export const pixelAt = (
  image: RgbaImage,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } => {
  if (!isInside(image, x, y)) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const offset = (y * image.width + x) * 4;
  return {
    r: image.data[offset] ?? 0,
    g: image.data[offset + 1] ?? 0,
    b: image.data[offset + 2] ?? 0,
    a: image.data[offset + 3] ?? 0,
  };
};

/** Rec. 601 luminance, rounded to an integer 0–255. */
export const luminance = (pixel: { r: number; g: number; b: number }): number =>
  Math.round(0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b);

const clamp255 = (value: number): number => {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return Math.round(value);
};

/**
 * The tight bounding box of pixels whose alpha is at least `alphaFloor`.
 * Returns `undefined` for a fully transparent image.
 */
export const findOpaqueBounds = (image: RgbaImage, alphaFloor = 1): PixelBounds | undefined => {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) < alphaFloor) {
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }

  return maxX < 0 ? undefined : { minX, minY, maxX, maxY };
};

/** Crops a rectangle out of an image. The rectangle is clipped to the image. */
export const cropRgbaImage = (image: RgbaImage, bounds: PixelBounds): RgbaImage => {
  const minX = Math.max(0, bounds.minX);
  const minY = Math.max(0, bounds.minY);
  const maxX = Math.min(image.width - 1, bounds.maxX);
  const maxY = Math.min(image.height - 1, bounds.maxY);
  const width = Math.max(0, maxX - minX + 1);
  const height = Math.max(0, maxY - minY + 1);
  const output = createRgbaImage({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(output, x, y, pixelAt(image, minX + x, minY + y));
    }
  }
  return output;
};

/**
 * Nearest-neighbour resample. Never blends: an output pixel is a copy of
 * exactly one input pixel, which is what true pixel-art clusters require and
 * what makes "the resample invented colours" a detectable defect.
 */
export const resampleNearest = (
  image: RgbaImage,
  target: { width: number; height: number },
): RgbaImage => {
  const output = createRgbaImage(target);
  for (let y = 0; y < target.height; y++) {
    const sourceY = Math.min(
      image.height - 1,
      Math.floor(((y + 0.5) * image.height) / target.height),
    );
    for (let x = 0; x < target.width; x++) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor(((x + 0.5) * image.width) / target.width),
      );
      setPixel(output, x, y, pixelAt(image, sourceX, sourceY));
    }
  }
  return output;
};

/**
 * Area-average ("box") resample in premultiplied colour.
 *
 * Weights are exact integers scaled by the destination size, so there is no
 * floating-point drift: two runs on two machines produce identical bytes. Each
 * pass rounds once, at the end, which keeps a separable horizontal+vertical
 * filter deterministic.
 */
export const resampleBoxAverage = (
  image: RgbaImage,
  target: { width: number; height: number },
): RgbaImage => {
  const horizontal = _resampleBoxAxis(image, target.width, 'x');
  return _resampleBoxAxis(horizontal, target.height, 'y');
};

const _resampleBoxAxis = (image: RgbaImage, targetSize: number, axis: 'x' | 'y'): RgbaImage => {
  const sourceSize = axis === 'x' ? image.width : image.height;
  const otherSize = axis === 'x' ? image.height : image.width;
  const outputWidth = axis === 'x' ? targetSize : image.width;
  const outputHeight = axis === 'x' ? image.height : targetSize;
  const output = createRgbaImage({ width: outputWidth, height: outputHeight });

  for (let line = 0; line < otherSize; line++) {
    for (let index = 0; index < targetSize; index++) {
      const start = index * sourceSize;
      const end = (index + 1) * sourceSize;
      let premultipliedR = 0;
      let premultipliedG = 0;
      let premultipliedB = 0;
      let alphaSum = 0;

      for (let source = 0; source < sourceSize; source++) {
        // Overlap of source pixel `source` with the destination interval
        // [start, end), both expressed in units of 1/targetSize source pixels.
        const sourceStart = source * targetSize;
        const sourceEnd = (source + 1) * targetSize;
        const weight = Math.min(end, sourceEnd) - Math.max(start, sourceStart);
        if (weight <= 0) {
          continue;
        }
        const pixel = axis === 'x' ? pixelAt(image, source, line) : pixelAt(image, line, source);
        // Premultiply so transparent-black neighbours cannot darken the edge.
        premultipliedR += pixel.r * pixel.a * weight;
        premultipliedG += pixel.g * pixel.a * weight;
        premultipliedB += pixel.b * pixel.a * weight;
        alphaSum += pixel.a * weight;
      }

      const alpha = clamp255(alphaSum / sourceSize);
      const unPremultiply = (channel: number): number =>
        alphaSum === 0 ? 0 : clamp255(channel / alphaSum);
      const pixel = {
        r: unPremultiply(premultipliedR),
        g: unPremultiply(premultipliedG),
        b: unPremultiply(premultipliedB),
        a: alpha,
      };
      if (axis === 'x') {
        setPixel(output, index, line, pixel);
      } else {
        setPixel(output, line, index, pixel);
      }
    }
  }

  return output;
};

/**
 * The largest axis-aligned rectangle of pixels whose alpha is at least
 * `alphaFloor`, using the classic O(width × height) histogram method.
 *
 * This is the machine check behind "no ground rectangle passes review": a
 * generated prop that still carries an opaque full-frame backdrop has one
 * enormous rectangle, while a genuine sprite's largest solid block is small.
 */
export const findLargestOpaqueRectangle = (
  image: RgbaImage,
  alphaFloor = 1,
): { area: number; bounds: PixelBounds } => {
  const heights = new Array<number>(image.width).fill(0);
  let best = { area: 0, bounds: { minX: 0, minY: 0, maxX: -1, maxY: -1 } };

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const opaque = (image.data[(y * image.width + x) * 4 + 3] ?? 0) >= alphaFloor;
      heights[x] = opaque ? (heights[x] ?? 0) + 1 : 0;
    }

    const stack: number[] = [];
    for (let x = 0; x <= image.width; x++) {
      const current = x === image.width ? 0 : (heights[x] ?? 0);
      while (stack.length > 0 && (heights[stack[stack.length - 1] ?? 0] ?? 0) >= current) {
        const top = stack.pop() ?? 0;
        const height = heights[top] ?? 0;
        const left = stack.length === 0 ? 0 : (stack[stack.length - 1] ?? 0) + 1;
        const width = x - left;
        const area = height * width;
        if (area > best.area) {
          best = {
            area,
            bounds: {
              minX: left,
              minY: y - height + 1,
              maxX: left + width - 1,
              maxY: y,
            },
          };
        }
      }
      stack.push(x);
    }
  }

  return best;
};

/**
 * The ground-contact point of a sprite: the horizontal centre of the opaque
 * pixels on its bottom-most opaque row, and that row's y.
 *
 * State variants of one prop must share this point, so "swaps do not jump in
 * the game preview" (AC-4) becomes a comparable pair of integers rather than a
 * visual impression.
 */
export const findGroundContact = (
  image: RgbaImage,
  alphaFloor = 1,
): { x: number; y: number } | undefined => {
  const bounds = findOpaqueBounds(image, alphaFloor);
  if (!bounds) {
    return undefined;
  }
  let sum = 0;
  let count = 0;
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    if (alphaAt(image, x, bounds.maxY) >= alphaFloor) {
      sum += x;
      count += 1;
    }
  }
  if (count === 0) {
    return undefined;
  }
  return { x: Math.round(sum / count), y: bounds.maxY };
};

/**
 * Grows a rectangle outward by `padding`, clipped to the image.
 *
 * A ground-contact origin is only meaningful if the content keeps the margin
 * the profile declares, so padding is applied to the crop, not to the pixels.
 */
export const expandBounds = (
  bounds: PixelBounds,
  padding: number,
  image: { width: number; height: number },
): PixelBounds => ({
  minX: Math.max(0, bounds.minX - padding),
  minY: Math.max(0, bounds.minY - padding),
  maxX: Math.min(image.width - 1, bounds.maxX + padding),
  maxY: Math.min(image.height - 1, bounds.maxY + padding),
});
