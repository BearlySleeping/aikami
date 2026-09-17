// packages/frontend/engine/src/rendering/weather/rain_texture.ts
// ---------------------------------------------------------------------------
// Rain streak texture — generated once, at pool-build time.
//
// A single tiny texture shared by both rain depth batches. PixiJS v8's
// `ParticleContainer` requires every particle to share one base texture, so
// far and near rain being *one* texture is what keeps the whole effect at two
// draw calls instead of two textures' worth of batch breaks.
//
// The texture is authored in a `Uint8Array` rather than drawn with `Graphics`
// or a 2D canvas:
//   - it is built once and never redrawn (no per-frame texture regeneration),
//   - it needs no DOM, so the renderer is constructible in headless tests,
//   - it is trivially replaceable by an authored weather atlas later — swap
//     this module's return value for an `Assets.load`ed `Texture` and nothing
//     else in the weather stack changes.
//
// Colour is baked as *premultiplied white*: the texture carries the streak's
// shape and opacity, and each batch's tint supplies the hue. That is what the
// PixiJS particle shader expects (it premultiplies the tint into the sample),
// so an unpremultiplied texture would render as a bright washed-out bar.
// ---------------------------------------------------------------------------

import { BufferImageSource, Texture } from 'pixi.js';
import {
  RAIN_STREAK_COLUMN_ALPHA,
  RAIN_STREAK_HEAD_EXPONENT,
  RAIN_STREAK_HEAD_FEATHER_DEPTH,
  RAIN_STREAK_HEAD_FEATHER_START,
  RAIN_STREAK_TEXTURE_HEIGHT,
  RAIN_STREAK_TEXTURE_WIDTH,
} from './weather_fx_config.ts';

/** Bytes per pixel in the generated RGBA buffer. */
const BYTES_PER_PIXEL = 4;

/** Hermite smoothstep, used for the head feather. */
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge1 <= edge0) {
    return x < edge0 ? 0 : 1;
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds the rain streak texture.
 *
 * The result is a short vertical streak with a faint tail and a brighter head:
 * a two-pixel-wide core whose opacity ramps up along the falling direction,
 * feathered at the very tip so the leading edge reads as a soft drop rather
 * than a chopped rectangle.
 *
 * @returns A nearest-neighbour, premultiplied, white RGBA texture. The caller
 *          owns it and must destroy it.
 */
export const createRainStreakTexture = (): Texture => {
  const width = RAIN_STREAK_TEXTURE_WIDTH;
  const height = RAIN_STREAK_TEXTURE_HEIGHT;
  const pixels = new Uint8Array(width * height * BYTES_PER_PIXEL);

  for (let y = 0; y < height; y++) {
    // 0 at the tail (top), 1 at the head (bottom). The head is the leading
    // edge of the fall — the direction the particle's rotation points.
    const along = height > 1 ? y / (height - 1) : 1;
    const feather =
      1 - smoothstep(RAIN_STREAK_HEAD_FEATHER_START, 1, along) * RAIN_STREAK_HEAD_FEATHER_DEPTH;
    const envelope = along ** RAIN_STREAK_HEAD_EXPONENT * feather;

    for (let x = 0; x < width; x++) {
      const column = RAIN_STREAK_COLUMN_ALPHA[x] ?? 1;
      const alpha = Math.round(Math.min(1, Math.max(0, envelope * column)) * 255);
      const offset = (y * width + x) * BYTES_PER_PIXEL;
      // Premultiplied white: RGB == A.
      pixels[offset] = alpha;
      pixels[offset + 1] = alpha;
      pixels[offset + 2] = alpha;
      pixels[offset + 3] = alpha;
    }
  }

  // `BufferImageSource`, NOT a bare `TextureSource`: only the buffer subclass
  // sets `uploadMethodId = 'buffer'`, which is how the renderer finds the GL/
  // WebGPU uploader for raw pixel data. A plain `TextureSource` leaves the id
  // at `'unknown'`, no uploader matches, and the texture silently never reaches
  // the GPU — every particle then draws fully transparent with no error.
  const source = new BufferImageSource({
    resource: pixels,
    width,
    height,
    format: 'rgba8unorm',
    // Already premultiplied by construction — telling Pixi so stops it from
    // multiplying a second time on upload.
    alphaMode: 'premultiplied-alpha',
    // Aikami's global policy (C-377 AC-1): pixel art samples nearest.
    scaleMode: 'nearest',
  });

  return new Texture({ source });
};
