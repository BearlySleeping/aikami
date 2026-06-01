// packages/frontend/engine/src/rendering/sprite_composer.ts
import { Container, Filter, GlProgram, Graphics, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
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

/**
 * GlProgram instance for the LPC Zero-Branch LUT pipeline.
 *
 * Created once and shared across all Filter instances. The vertex
 * shader uses the standard PixiJS v8 matrix uniforms; the fragment
 * shader performs a zero-branch palette lookup with half-pixel shift.
 */
const LPC_PROGRAM = new GlProgram({
  vertex: LPC_VERTEX_SHADER,
  fragment: LPC_FRAGMENT_SHADER,
  name: 'lpc-lut-zero-branch',
});

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
 * The caller owns the returned buffer and must re-pack when recipes change.
 * Up to {@link LPC_MAX_LAYERS} recipes are processed; extras are ignored.
 * Missing / inactive slots get zero-filled tint and `active = 0.0`.
 *
 * @param recipes - Layer recipes from the AI character manifest.
 * @returns A 64-element Float32Array with std140 padding.
 */
export const packRecipeToUboBuffer = (recipes: readonly LpcLayerRecipe[]): Float32Array => {
  const buffer = new Float32Array(LPC_UBO_FLOAT_COUNT);

  for (let i = 0; i < LPC_MAX_LAYERS; i++) {
    const recipe = recipes[i];
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
 * GLSL ES 3.0 vertex shader for multi-layer LPC rendering.
 *
 * Same matrix chain as the single-layer zero-branch shader — passes
 * through position and UV for each layer sample.
 */
const LPC_MULTI_LAYER_VERTEX_SHADER = /* glsl */ `#version 300 es

precision highp float;

in vec2 aPosition;
in vec2 aUV;

uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform mat3 uWorldTransformMatrix;

out vec2 vUV;

void main(void) {
  mat3 mvp = projectionMatrix * translationMatrix * uWorldTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * GLSL ES 3.0 fragment shader for multi-layer LPC compositing with std140 UBO.
 *
 * Samples up to 8 grayscale layer textures, tints each via the UBO-supplied
 * `u_layer_tints` colour, and composites active layers via additive blending.
 * Inactive layers (`u_active_layers[i] == 0.0`) are skipped at zero branch cost
 * (all fragments follow the same instruction path).
 *
 * Each grayscale texture's red channel provides the opacity mask; the UBO tint
 * supplies the RGB colour. Layers blend top-to-bottom via front-to-back
 * alpha compositing.
 */
const LPC_MULTI_LAYER_FRAGMENT_SHADER = /* glsl */ `#version 300 es

precision highp float;

in vec2 vUV;

// 8 grayscale layer textures (R channel = opacity mask)
uniform sampler2D uTexture0;
uniform sampler2D uTexture1;
uniform sampler2D uTexture2;
uniform sampler2D uTexture3;
uniform sampler2D uTexture4;
uniform sampler2D uTexture5;
uniform sampler2D uTexture6;
uniform sampler2D uTexture7;

// std140 uniform block — see packRecipeToUboBuffer for JS layout
layout(std140) uniform LpcCharacterData {
    vec4 u_layer_tints[8];
    float u_active_layers[8];
};

out vec4 outColor;

void main(void) {
  // Accumulated colour (premultiplied alpha)
  vec4 result = vec4(0.0);

  // Layer 0
  if (u_active_layers[0] > 0.5) {
    vec4 src = texture(uTexture0, vUV);
    vec4 tinted = vec4(u_layer_tints[0].rgb, 1.0) * src.r;
    result = vec4(tinted.rgb * tinted.a, tinted.a);
  }

  // Layer 1 — front-to-back composite
  if (u_active_layers[1] > 0.5) {
    vec4 src = texture(uTexture1, vUV);
    vec4 tinted = vec4(u_layer_tints[1].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  // Layer 2
  if (u_active_layers[2] > 0.5) {
    vec4 src = texture(uTexture2, vUV);
    vec4 tinted = vec4(u_layer_tints[2].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  // Layer 3
  if (u_active_layers[3] > 0.5) {
    vec4 src = texture(uTexture3, vUV);
    vec4 tinted = vec4(u_layer_tints[3].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  // Layer 4
  if (u_active_layers[4] > 0.5) {
    vec4 src = texture(uTexture4, vUV);
    vec4 tinted = vec4(u_layer_tints[4].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  // Layer 5
  if (u_active_layers[5] > 0.5) {
    vec4 src = texture(uTexture5, vUV);
    vec4 tinted = vec4(u_layer_tints[5].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  // Layer 6
  if (u_active_layers[6] > 0.5) {
    vec4 src = texture(uTexture6, vUV);
    vec4 tinted = vec4(u_layer_tints[6].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  // Layer 7
  if (u_active_layers[7] > 0.5) {
    vec4 src = texture(uTexture7, vUV);
    vec4 tinted = vec4(u_layer_tints[7].rgb, 1.0) * src.r;
    float srcAlpha = tinted.a;
    result = vec4(
      result.rgb + tinted.rgb * srcAlpha * (1.0 - result.a),
      result.a + srcAlpha * (1.0 - result.a)
    );
  }

  outColor = result;
}
`;

/**
 * GlProgram instance for the LPC multi-layer UBO pipeline.
 *
 * Created once and shared across all multi-layer compositions.
 * Packs up to 8 character layout layers into a single draw call
 * with std140 uniform block data.
 */
const LPC_MULTI_LAYER_PROGRAM = new GlProgram({
  vertex: LPC_MULTI_LAYER_VERTEX_SHADER,
  fragment: LPC_MULTI_LAYER_FRAGMENT_SHADER,
  name: 'lpc-multi-layer-ubo',
});

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
 * The filter wraps the shared {@link LPC_PROGRAM} GlProgram and binds
 * the `uPalette` uniform to the provided palette lookup texture.
 *
 * @param paletteTexture - The 256×1 RGBA palette LUT texture.
 * @returns A configured PixiJS `Filter` instance.
 */
const createPaletteFilter = (paletteTexture: Texture): Filter => {
  return new Filter({
    glProgram: LPC_PROGRAM,
    resources: {
      paletteUniforms: {
        uPalette: paletteTexture.source,
      },
    },
  });
};

/**
 * Composes layered sprites for an entity, optionally applying a Zero-Branch
 * LUT palette shader for recoloured character rendering.
 *
 * Each entity that has an `Appearance` component gets a PixiJS `Container`
 * managed by this composer. Layer composition supports two paths:
 *
 * 1. **Basic** (legacy): Layer textures loaded by ID, composited into a
 *    flat cached GPU texture via `cacheAsTexture`.
 *
 * 2. **Palette-mapped** (LPC pipeline): A grayscale base sheet receives a
 *    GLSL ES 3.0 Filter that applies palette recolouring via a 256×1 LUT
 *    texture. No CPU canvas swaps. No thread divergence.
 *
 * The class returns a placeholder container immediately, then asynchronously
 * replaces it with proper sprites. All palette textures use `NEAREST` scaling.
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
   * Composes a multi-layer sprite using the UBO batched pipeline.
   *
   * Packs up to 8 character layout layers into a single GPU draw call
   * via an std140 Uniform Buffer Object. Tint colours and activation
   * flags are extracted from the {@link LpcLayerRecipe} array and
   * uploaded once per structural change — not per frame.
   *
   * Returns a placeholder container immediately. When all grayscale
   * textures resolve, the placeholder is replaced with a multi-layer
   * filtered sprite that composites all active layers in one shader pass.
   *
   * @param options - Multi-layer composition options.
   * @param options.recipes - Array of up to 8 LPC layer recipes.
   * @returns A PixiJS `Container` with placeholder, replaced on load.
   */
  composeMultiLayerSprite(options: { recipes: readonly LpcLayerRecipe[] }): Container {
    const { recipes } = options;
    const container = new Container();
    const placeholder = addPlaceholder(container);

    this._loadAndComposeMultiLayer(container, placeholder, recipes);

    return container;
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
   * Loads all grayscale sheets for the given recipes and replaces the
   * placeholder with a multi-layer UBO-composited sprite.
   *
   * Each active recipe's grayscale texture is fetched via the texture
   * manager and bound to one of the 8 sampler slots. The UBO buffer
   * is packed from the tint colours extracted from each recipe's
   * palette LUT, and uploaded once as a uniform block.
   */
  private async _loadAndComposeMultiLayer(
    container: Container,
    placeholder: Graphics,
    recipes: readonly LpcLayerRecipe[],
  ): Promise<void> {
    const activeRecipes = recipes.filter((r) => r?.assetId);

    if (activeRecipes.length === 0) {
      container.cacheAsTexture(true);
      return;
    }

    try {
      const texturePromises = activeRecipes
        .slice(0, LPC_MAX_LAYERS)
        .map((recipe) =>
          this._textureManager.getGrayscaleSheet(Number.parseInt(recipe.assetId, 10)),
        );
      const textures = await Promise.all(texturePromises);

      container.removeChild(placeholder);
      placeholder.destroy();

      const uboBuffer = packRecipeToUboBuffer(recipes);

      // Build the resource map for all 8 texture slots
      const samplerResources: Record<string, Texture['source']> = {};
      for (let i = 0; i < LPC_MAX_LAYERS; i++) {
        const tex = textures[i] ?? Texture.EMPTY;
        samplerResources[`uTexture${i}`] = tex.source;
      }

      // Pack tint colours as 8 vec4s (32 floats) and active flags as 8 floats
      // UniformGroup with ubo:true handles std140 packing automatically
      const lpcUniforms = new UniformGroup(
        {
          // biome-ignore lint/style/useNamingConvention: GLSL uniform names
          u_layer_tints: { value: new Float32Array(uboBuffer.buffer, 0, 32), type: 'vec4<f32>' },
          // biome-ignore lint/style/useNamingConvention: GLSL uniform names
          u_active_layers: { value: new Float32Array(uboBuffer.buffer, 32 * 4, 8), type: 'f32' },
        },
        { ubo: true },
      );

      const filter = new Filter({
        glProgram: LPC_MULTI_LAYER_PROGRAM,
        resources: {
          lpcUniforms,
          ...samplerResources,
        },
      });

      // Create a single sprite covering all layers; the filter composites them
      const baseTexture = textures[0] ?? Texture.WHITE;
      const sprite = new Sprite(baseTexture);
      sprite.filters = [filter];

      container.addChild(sprite);
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
}
