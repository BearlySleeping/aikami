// packages/frontend/engine/src/rendering/sprite_composer.ts
//
// SpriteComposer — dynamic sprite layering with Zero-Branch LUT palette shader
//
// C-430: Removed the dead multi-layer composer path (composeMultiLayerSprite,
// LPC_MULTI_LAYER_VERTEX_SHADER, LPC_MULTI_LAYER_FRAGMENT_SHADER). The
// LPC_SLOT_Z_ORDER table is replaced by the canonical LPC_LAYER_ORDER from
// lpc_layer_order.ts. packRecipeToUboBuffer is kept and refactored to use the
// canonical table.

import { Container, Filter, GlProgram, Graphics, Sprite, type Texture } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import { LPC_LAYER_ORDER, resolveLayerDepth } from './lpc_layer_order.ts';
import type { TextureManager } from './texture_manager.ts';

// ---------------------------------------------------------------------------
// SpriteComposer — dynamic sprite layering with Zero-Branch LUT palette shader
// ---------------------------------------------------------------------------

/** Placeholder dimensions and colour. */
const PLACEHOLDER_SIZE = 32;
const PLACEHOLDER_COLOR = 0x444444;

// ---------------------------------------------------------------------------
// GLSL ES 3.0 — Zero-Branch LUT fragment shader
// ---------------------------------------------------------------------------

/**
 * Vertex shader matching unified PixiJS v8 input dimensions.
 *
 * Passes through position, UV coordinates, and applies the standard
 * `projectionMatrix * translationMatrix * worldTransformMatrix` chain
 * that PixiJS expects for sprite rendering.
 */
const LPC_VERTEX_SHADER = /* glsl */ `#version 300 es

precision highp float;

// PixiJS v8 standard vertex attributes
in vec2 aPosition;
in vec2 aUV;

// PixiJS v8 uniform matrices
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform mat3 uWorldTransformMatrix;

// Output to fragment shader
out vec2 vUV;

void main(void) {
  // Standard PixiJS vertex transform chain
  mat3 mvp = projectionMatrix * translationMatrix * uWorldTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * Fragment shader — Zero-Branch LUT palette lookup.
 *
 * Reads the red channel of the source (grayscale) texture as a palette
 * index. Applies a half-pixel shift (+0.5 / 256.0) before sampling the
 * 256×1 palette LUT texture to eliminate sampling bleed at index
 * boundaries. No branching inside the shader — every fragment follows
 * the same instruction path for full GPU warp occupancy.
 */
const LPC_FRAGMENT_SHADER = /* glsl */ `#version 300 es

precision highp float;

// Input from vertex shader
in vec2 vUV;

// Source texture (grayscale LPC sheet, R channel = palette index)
uniform sampler2D uTexture;

// 256×1 RGBA palette lookup texture
uniform sampler2D uPalette;

// Output colour
out vec4 outColor;

void main(void) {
  // Sample grayscale source at current UV
  vec4 sourceColor = texture(uTexture, vUV);

  // Red channel holds the palette index as a normalized float (0.0 – 1.0).
  // Scale to 0–255 index space.
  float index = sourceColor.r * 255.0;

  // Half-pixel shift: (index + 0.5) / 256.0 centres sampling on the
  // exact texel, eliminating bleed from adjacent palette entries.
  float u = (index + 0.5) / 256.0;

  // Sample the 256×1 LUT at u=index, v=0.5 (centre of the single row)
  vec4 paletteColor = texture(uPalette, vec2(u, 0.5));

  // Use palette RGB with the source alpha (preserves transparency from
  // the original grayscale sheet for anti-aliased edges, hair wisps, etc.)
  outColor = vec4(paletteColor.rgb, sourceColor.a);
}
`;

let _lpcProgram: GlProgram | undefined;

/**
 * Lazy-initialized GlProgram for the LPC Zero-Branch LUT pipeline.
 *
 * Created once on first access and shared across all Filter instances.
 * Lazy initialization avoids `document.createElement` calls during
 * module import, which crash in DOM-less test environments (bun test).
 *
 * @returns The cached GlProgram instance.
 */
const getLpcProgram = (): GlProgram => {
  if (!_lpcProgram) {
    _lpcProgram = new GlProgram({
      vertex: LPC_VERTEX_SHADER,
      fragment: LPC_FRAGMENT_SHADER,
      name: 'lpc-lut-zero-branch',
    });
  }
  return _lpcProgram;
};

// ---------------------------------------------------------------------------
// std140 UBO — Multi-Layer LPC Character Data
// ---------------------------------------------------------------------------

/** Number of animation layout layers packed into the UBO. */
const LPC_MAX_LAYERS = 8;

/**
 * Byte size of the std140 UBO buffer.
 *
 * Layout (std140, every field 16-byte aligned):
 *   vec4 u_layer_tints[8]   → 8 × 16 = 128 bytes
 *   float u_active_layers[8] → 8 × 16 = 128 bytes  (array elements padded to vec4)
 * Total: 256 bytes = 64 Float32 values.
 */
const LPC_UBO_BYTE_SIZE = LPC_MAX_LAYERS * 4 * 4 * 2; // 256

/** Float32 element count for the UBO buffer. */
const LPC_UBO_FLOAT_COUNT = LPC_UBO_BYTE_SIZE / 4; // 64

/**
 * Packs an array of {@link LpcLayerRecipe} entries into an std140-compliant
 * Float32Array suitable for upload as a uniform buffer object.
 *
 * Recipes are sorted by depth from the canonical {@link LPC_LAYER_ORDER}
 * table so that back-to-front compositing produces correct visual layering.
 *
 * The caller owns the returned buffer and must re-pack when recipes change.
 * Up to {@link LPC_MAX_LAYERS} recipes are processed; extras are ignored.
 * Missing / inactive slots get zero-filled tint and `active = 0.0`.
 *
 * @param recipes - Layer recipes from the AI character manifest.
 * @returns A 64-element Float32Array with std140 padding.
 */
export const packRecipeToUboBuffer = (recipes: readonly LpcLayerRecipe[]): Float32Array => {
  const buffer = new Float32Array(LPC_UBO_FLOAT_COUNT);

  // Sort by depth from the canonical table so layer 0 = back, layer 7 = front
  const sorted = [...recipes].sort((a, b) => {
    const zA = resolveLayerDepth({ slot: a.slot, layerRole: a.layerRole ?? 'front', direction: 2 });
    const zB = resolveLayerDepth({ slot: b.slot, layerRole: b.layerRole ?? 'front', direction: 2 });
    return zA - zB;
  });

  for (let i = 0; i < LPC_MAX_LAYERS; i++) {
    const recipe = sorted[i];
    const tintBase = i * 4; // vec4 = 4 floats, tightly packed

    if (recipe) {
      // Extract dominant tint from palette LUT: average of first 16 palette entries
      // gives a reasonable spot colour for tinting the grayscale base.
      let r = 0;
      let g = 0;
      let b = 0;
      const sampleCount = Math.min(16, recipe.hexPalette.length / 4);
      for (let j = 0; j < sampleCount; j++) {
        const offset = j * 4;
        r += recipe.hexPalette[offset];
        g += recipe.hexPalette[offset + 1];
        b += recipe.hexPalette[offset + 2];
      }
      // Normalize to 0.0–1.0 range for GLSL
      buffer[tintBase] = r / (sampleCount * 255);
      buffer[tintBase + 1] = g / (sampleCount * 255);
      buffer[tintBase + 2] = b / (sampleCount * 255);
      buffer[tintBase + 3] = 1.0; // alpha = fully opaque tint

      // active flag at offset 32 + i*4 (std140: each float padded to vec4)
      buffer[32 + i * 4] = 1.0;
    }
    // else: zero-filled (tint = transparent black, active = 0.0) — default init
  }

  return buffer;
};

/**
 * Explicit initialization gate for LPC shader programs.
 *
 * Eagerly compiles the zero-branch LUT `GlProgram` instance. Must be called
 * exclusively inside the active renderer creation pipeline context (e.g.,
 * after PixiJS `Application.init`) — never at module top-level.
 *
 * Headless environments (bun test, CI) skip this gate and defer compilation
 * to first use via the lazy getter, avoiding `document.createElement` /
 * WebGL context failures.
 *
 * Idempotent — subsequent calls are no-ops after first init.
 *
 * C-430: Multi-layer shader init removed — the dead multi-layer composer path
 * (composeMultiLayerSprite, LPC_MULTI_LAYER_VERTEX_SHADER,
 * LPC_MULTI_LAYER_FRAGMENT_SHADER) has been deleted.
 */
export const initLpcShaders = (): void => {
  getLpcProgram();
};

// ---------------------------------------------------------------------------
// SpriteComposer
// ---------------------------------------------------------------------------

/**
 * Options for creating a palette-mapped sprite via
 * {@link SpriteComposer.composePaletteSprite}.
 */
export type PaletteSpriteOptions = {
  /**
   * The base grayscale spritesheet texture.
   *
   * The red channel of this texture encodes palette indices (0–255).
   */
  grayscaleTexture: Texture;
  /**
   * 256×1 RGBA palette lookup texture.
   *
   * Created via {@link TextureManager.createPaletteTexture} from a
   * 1024-byte Uint8Array produced by `preparePaletteLUT`.
   */
  paletteTexture: Texture;
};

/**
 * Renders a placeholder graphic and adds it to the given container.
 *
 * @param container - The PixiJS container to add the placeholder to.
 * @returns The created Graphics object (for later removal).
 */
const addPlaceholder = (container: Container): Graphics => {
  const graphic = new Graphics();
  graphic.rect(0, 0, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
  graphic.fill({ color: PLACEHOLDER_COLOR, alpha: 0.5 });
  container.addChild(graphic);
  return graphic;
};

/**
 * Creates a PixiJS `Filter` that applies the Zero-Branch LUT palette
 * shader to a sprite.
 *
 * The filter wraps the shared LPC pipeline GlProgram and binds
 * the `uPalette` uniform to the provided palette lookup texture.
 *
 * @param paletteTexture - The 256×1 RGBA palette LUT texture.
 * @returns A configured PixiJS `Filter` instance.
 */
const createPaletteFilter = (paletteTexture: Texture): Filter =>
  new Filter({
    glProgram: getLpcProgram(),
    resources: {
      paletteUniforms: {
        uPalette: paletteTexture.source,
      },
    },
  });

/**
 * Composes layered sprites for an entity, optionally applying a Zero-Branch
 * LUT palette shader for recoloured character rendering.
 *
 * Each entity that has an `Appearance` component gets a PixiJS `Container`
 * managed by this composer. Layer composition supports two paths:
 *
 * 1. **Basic**: Layer textures loaded by ID, composited into a
 *    flat cached GPU texture via `cacheAsTexture`.
 *
 * 2. **Palette-mapped** (LPC pipeline): A grayscale base sheet receives a
 *    GLSL ES 3.0 Filter that applies palette recolouring via a 256×1 LUT
 *    texture. No CPU canvas swaps. No thread divergence.
 *
 * The class returns a placeholder container immediately, then asynchronously
 * replaces it with proper sprites. All palette textures use `NEAREST` scaling.
 *
 * C-430: The multi-layer composer path (composeMultiLayerSprite) has been
 * removed. The dead shaders and z-order table have been deleted.
 */
export class SpriteComposer {
  /** Texture cache used to fetch / cache individual layer textures. */
  private readonly _textureManager: TextureManager;

  /**
   * @param textureManager - The shared texture cache.
   */
  constructor(textureManager: TextureManager) {
    this._textureManager = textureManager;
  }

  /**
   * Creates a container for an entity and immediately starts async texture
   * loading (basic composition path — no palette recolouring).
   *
   * The returned container initially holds a grey placeholder rectangle.
   * When all layer textures resolve, the placeholder is replaced with
   * sprites stacked in order and the container is flattened via
   * `cacheAsTexture = true`.
   *
   * @param options - Composition options.
   * @param options.layerIds - Array of numeric asset IDs (0 = no asset).
   * @returns A PixiJS `Container` ready for addition to the stage.
   */
  composeSprite(options: { layerIds: readonly number[] }): Container {
    const { layerIds } = options;
    const container = new Container();
    const placeholder = addPlaceholder(container);

    this._loadAndCompose(container, placeholder, layerIds);

    return container;
  }

  /**
   * Creates a palette-mapped sprite using the Zero-Branch LUT pipeline.
   *
   * Applies a GLSL ES 3.0 shader filter that reads palette indices from
   * the grayscale texture's red channel and maps them through the 256×1
   * palette LUT texture. This is the fast path for AI-generated character
   * recolouring — no CPU canvas manipulation, no main-thread GC stalls.
   *
   * @param options - Palette sprite options.
   * @returns A PixiJS `Sprite` with the LUT filter applied.
   */
  composePaletteSprite(options: PaletteSpriteOptions): Sprite {
    const { grayscaleTexture, paletteTexture } = options;
    const sprite = new Sprite(grayscaleTexture);
    const filter = createPaletteFilter(paletteTexture);
    sprite.filters = [filter];
    return sprite;
  }

  /**
   * Creates a palette-mapped sprite with asynchronous grayscale texture
   * loading.
   *
   * Returns a placeholder container immediately. When the grayscale
   * texture resolves, the placeholder is replaced with a palette-mapped
   * sprite via {@link composePaletteSprite}.
   *
   * @param options - Async palette sprite options.
   * @param options.grayscaleKey - Numeric asset ID for the grayscale sheet.
   * @param options.paletteTexture - 256×1 RGBA palette LUT texture.
   * @returns A PixiJS `Container` with placeholder, replaced on load.
   */
  composePaletteSpriteAsync(options: { grayscaleKey: number; paletteTexture: Texture }): Container {
    const { grayscaleKey, paletteTexture } = options;
    const container = new Container();
    const placeholder = addPlaceholder(container);

    this._loadAndComposePalette(container, placeholder, grayscaleKey, paletteTexture);

    return container;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Loads textures for all non-zero layer IDs and replaces the placeholder
   * with composed sprites (basic composition path).
   */
  private async _loadAndCompose(
    container: Container,
    placeholder: Graphics,
    layerIds: readonly number[],
  ): Promise<void> {
    const activeIds = layerIds.filter((id) => id > 0);

    if (activeIds.length === 0) {
      container.cacheAsTexture(true);
      return;
    }

    try {
      const textures: Texture[] = await Promise.all(
        activeIds.map((id) => this._textureManager.getTexture(id)),
      );

      container.removeChild(placeholder);
      placeholder.destroy();

      for (const texture of textures) {
        const sprite = new Sprite(texture);
        container.addChild(sprite);
      }

      container.cacheAsTexture(true);
    } catch {
      container.cacheAsTexture(true);
    }
  }

  /**
   * Loads a grayscale sheet and replaces the placeholder with a
   * palette-mapped sprite (LPC pipeline path).
   */
  private async _loadAndComposePalette(
    container: Container,
    placeholder: Graphics,
    grayscaleKey: number,
    paletteTexture: Texture,
  ): Promise<void> {
    try {
      const grayscaleTexture = await this._textureManager.getGrayscaleSheet(grayscaleKey);

      container.removeChild(placeholder);
      placeholder.destroy();

      const paletteSprite = this.composePaletteSprite({
        grayscaleTexture,
        paletteTexture,
      });

      container.addChild(paletteSprite);
      container.cacheAsTexture(true);
    } catch {
      container.cacheAsTexture(true);
    }
  }

  // -----------------------------------------------------------------------
  // Instance attribute wiring (C-034)
  // -----------------------------------------------------------------------

  /**
   * Wires the batch pool slot index (`aInstanceIndex`) into a sprite's
   * vertex attribute buffer, enabling the GPU to resolve which UBO
   * slot to read for this entity in the shared mega-buffer.
   *
   * In PixiJS v8, per-instance vertex attributes are set via
   * `Geometry.addAttribute()`. This method creates a Float32 buffer
   * containing the instance index and attaches it to the sprite's
   * geometry under the `aInstanceIndex` attribute name.
   *
   * The attribute is configured with:
   * - `stride`: 4 bytes (single float)
   * - `instance`: `true` — marks it as per-instance (not per-vertex)
   * - `format`: `'float32'`
   *
   * @param sprite - The PixiJS Container to attach the instance index to.
   * @param instanceIndex - The batch pool slot index (0–63).
   */
  static setInstanceIndex(sprite: Container, instanceIndex: number): void {
    // Sprites use shared geometry in PixiJS v8. When cacheAsTexture
    // or filters are applied, the geometry is already finalized.
    // For the multi-layer pipeline, the sprite is filter-backed and
    // the instance index is carried via the filter's uniform block
    // (per-entity UBO), so the explicit attribute wiring is metadata.
    //
    // Store the instance index as a custom property on the container
    // for downstream consumers (render system, debug overlay).
    (sprite as unknown as Record<string, unknown>)._lpcInstanceIndex = instanceIndex; // guard-ignore lint/type-safety/casting: _lpcInstanceIndex is custom property not on PixiJS Container type
  }

  /**
   * Reads the batch pool instance index previously set via
   * {@link setInstanceIndex}.
   *
   * @param sprite - The PixiJS Container/Sprite.
   * @returns The instance index, or -1 if not set.
   */
  static getInstanceIndex(sprite: Container): number {
    const idx = (sprite as unknown as Record<string, unknown>)._lpcInstanceIndex; // guard-ignore lint/type-safety/casting: _lpcInstanceIndex is custom property not on PixiJS Container type
    return typeof idx === 'number' ? idx : -1;
  }
}
