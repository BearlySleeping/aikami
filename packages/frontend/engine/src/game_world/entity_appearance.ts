// packages/frontend/engine/src/game_world/entity_appearance.ts
//
// Entity appearance loading boundary.
//
// Loads LPC layer textures for one entity entirely off-scene, orders them
// with the canonical depth/composer rules, and only then commits them to the
// live display object in one synchronous swap. This makes replacement atomic:
// a superseded or failed load can never remove the visuals that are currently
// on screen, and stale layers are disposed without touching textures owned by
// the shared asset/texture caches.
//
// The loader owns no game state. It receives only the URL resolver, texture
// manager, and texture loader it actually uses, so it is unit-testable with
// doubles and does not need a PixiJS renderer.

import { compileLpcSpriteToVisualDefinition } from '@aikami/lpc';
import type { CompleteSpriteDefinition } from '@aikami/schemas';
import { Assets, Container, Sprite, type Spritesheet, Texture } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import type { AnimationController } from '../rendering/animation_controller.ts';
import { composeLpcRecipePasses } from '../rendering/component_composer.ts';
import { resolveLayerDepth } from '../rendering/lpc_layer_order.ts';
import { resolveLpcSheetGeometry } from '../rendering/lpc_sheet_geometry.ts';
import type { TextureManager } from '../rendering/texture_manager.ts';
import { resolveDefinitionFrameAtTime } from '../rendering/visual_definition_playback.ts';

/** One renderable LPC layer: its sprite plus the metadata needed per frame. */
export type AppearanceLayer = {
  sprite: Sprite;
  recipe: LpcLayerRecipe;
  texture?: Texture;
  spritesheet?: Spritesheet;
  /** C-496 AC-3: compiled shared visual definition for this layer. */
  definition?: CompleteSpriteDefinition;
};

/** A fully loaded appearance staged off-scene, ready for an atomic commit. */
export type PreparedAppearance = {
  /** Detached container holding the layer sprites in final order. */
  container: Container;
  /** Layers in final draw order (recipe/composer/depth resolved). */
  layers: AppearanceLayer[];
};

export type EntityAppearanceLoaderOptions = {
  /** Resolves a slot/asset/state to a texture URL (null when unmapped). */
  resolveAssetUrl: (slot: string, assetId: string, state: string) => string | null;
  /** Optional shared texture manager for cached spritesheet/frame slicing. */
  textureManager?: TextureManager;
  /** Texture loader, injectable for tests. Defaults to PixiJS Assets. */
  loadTexture?: (url: string) => Promise<Texture>;
  /** Receives non-fatal per-layer load failures. */
  onLoadError?: (info: { url: string; error: string }) => void;
};

const defaultLoadTexture = (url: string): Promise<Texture> => Assets.load<Texture>(url);

/**
 * Orders layers by the canonical LPC depth table, then the shared composer's
 * pass order, then original recipe order (stable tie-break).
 */
const orderLayers = (layers: readonly AppearanceLayer[]): AppearanceLayer[] => {
  const composition = composeLpcRecipePasses({
    recipes: layers.map((layer) => layer.recipe),
  });
  const compositionOrder = new Map(
    composition.order.map((recipeIndex, position) => [recipeIndex, position]),
  );

  const withIndex = layers.map((layer, index) => ({ layer, index }));
  withIndex.sort((a, b) => {
    const zA = resolveLayerDepth({
      slot: a.layer.recipe.slot,
      layerRole: a.layer.recipe.layerRole ?? 'front',
      direction: 2, // default facing (down)
    });
    const zB = resolveLayerDepth({
      slot: b.layer.recipe.slot,
      layerRole: b.layer.recipe.layerRole ?? 'front',
      direction: 2,
    });
    if (zA !== zB) {
      return zA - zB;
    }
    const posA = compositionOrder.get(a.index) ?? a.index;
    const posB = compositionOrder.get(b.index) ?? b.index;
    if (posA !== posB) {
      return posA - posB;
    }
    return a.index - b.index;
  });
  return withIndex.map((item) => item.layer);
};

export class EntityAppearanceLoader {
  private readonly _resolveAssetUrl: (
    slot: string,
    assetId: string,
    state: string,
  ) => string | null;
  private readonly _textureManager: TextureManager | undefined;
  private readonly _loadTexture: (url: string) => Promise<Texture>;
  private readonly _onLoadError: ((info: { url: string; error: string }) => void) | undefined;

  constructor(options: EntityAppearanceLoaderOptions) {
    this._resolveAssetUrl = options.resolveAssetUrl;
    this._textureManager = options.textureManager;
    this._loadTexture = options.loadTexture ?? defaultLoadTexture;
    this._onLoadError = options.onLoadError;
  }

  /**
   * Loads and orders every resolvable layer for `recipes` into a detached
   * container. Never touches a live display object; the caller decides
   * whether to {@link commit} or {@link disposePrepared}.
   */
  async prepare(options: {
    recipes: readonly LpcLayerRecipe[];
    state: string;
  }): Promise<PreparedAppearance> {
    const loaded = await Promise.all(
      options.recipes.map((recipe) => this._loadLayer(recipe, options.state)),
    );
    const layers = orderLayers(
      loaded.filter((layer): layer is AppearanceLayer => layer !== undefined),
    );

    const container = new Container();
    container.eventMode = 'none';
    for (const layer of layers) {
      container.addChild(layer.sprite);
    }
    return { container, layers };
  }

  /**
   * Atomically replaces the target's current children with the prepared
   * layers: the old display objects are removed and destroyed in the same
   * synchronous step that adds the new ones, so there is no blank frame.
   *
   * Only sprite display objects are destroyed — textures belong to shared
   * caches and must survive.
   */
  commit(options: { target: Container; prepared: PreparedAppearance }): void {
    const stale = options.target.removeChildren();
    for (const child of stale) {
      child.destroy();
    }
    for (const layer of options.prepared.layers) {
      options.target.addChild(layer.sprite);
    }
    options.prepared.container.destroy();
  }

  /**
   * Releases a prepared appearance that will not be committed (stale load,
   * entity replaced, or partial failure). Destroys sprites only.
   */
  disposePrepared(prepared: PreparedAppearance): void {
    prepared.container.destroy({ children: true });
  }

  private async _loadLayer(
    recipe: LpcLayerRecipe,
    state: string,
  ): Promise<AppearanceLayer | undefined> {
    if (!recipe.assetId) {
      return undefined;
    }
    const url = this._resolveAssetUrl(recipe.slot ?? 'body', recipe.assetId, state);
    if (!url) {
      return undefined;
    }

    try {
      const texture = await this._loadTexture(url);
      texture.source.scaleMode = 'nearest';

      // C-428: resolve sheet geometry from actual dimensions.
      const geometry = resolveLpcSheetGeometry(texture);

      // C-168: create a cached Spritesheet so frame lookup is WebGPU-safe.
      let spritesheet: Spritesheet | undefined;
      if (this._textureManager && geometry.columns > 0 && geometry.rows > 0) {
        spritesheet = await this._textureManager.getOrCreateSpritesheet({
          baseTexture: texture,
          layout: {
            frameWidth: geometry.pitch,
            frameHeight: geometry.pitch,
            columns: geometry.columns,
            rows: geometry.rows,
            keyPrefix: state,
          },
          cacheKey: `${url}::${geometry.pitch}`,
        });
      }

      const sprite = new Sprite(Texture.WHITE);
      sprite.eventMode = 'none';
      // C-428: anchor the logical body. Feet are at bottom-center for the
      // standard 64px cell; oversize 128px cells center the body, so feet sit
      // at (0.5, 0.75).
      sprite.anchor.set(0.5, geometry.pitch === 64 ? 1.0 : 0.75);

      // C-496 AC-3/AC-6: compile the shared visual definition once at load so
      // the render path resolves frames through the same validated definition
      // the previews use.
      let definition: CompleteSpriteDefinition | undefined;
      try {
        definition = compileLpcSpriteToVisualDefinition({
          assetId: recipe.assetId ?? recipe.slot ?? 'layer',
          geometry,
          revision: 'engine-v1',
          source: 'engine',
          licenses: recipe.licenses ?? [],
          imageWidth: texture.width,
          imageHeight: texture.height,
          artifactRef: url,
        });
      } catch {
        definition = undefined;
      }

      return { sprite, recipe, texture, spritesheet, definition };
    } catch (error) {
      this._onLoadError?.({ url, error: String(error) });
      return undefined;
    }
  }
}

/**
 * LPC direction names keyed by row offset (C-496 AC-3). Used to derive clip
 * names like `walk.down` when resolving frames through the shared definition.
 */
const DIRECTION_NAMES: Record<number, string> = {
  0: 'up',
  1: 'left',
  2: 'down',
  3: 'right',
} as const;

/**
 * Applies the current animation frame to every loaded layer sprite.
 *
 * Prefers the shared visual definition compiled at load (elapsed-time clock +
 * actor fallback); falls back to the legacy row/column spritesheet path when
 * the definition cannot slice a texture. Performs only synchronous texture
 * lookups — no per-frame allocation.
 */
export const applyLpcFrameToEntry = (options: {
  layers: readonly AppearanceLayer[] | undefined;
  controller: AnimationController;
  textureManager?: TextureManager;
}): void => {
  const { layers, controller, textureManager } = options;
  if (!layers || layers.length === 0) {
    return;
  }

  const row = controller.direction as number; // Up=0, Left=1, Down=2, Right=3
  const directionName = DIRECTION_NAMES[controller.direction];

  for (const layer of layers) {
    if (!layer.texture) {
      continue;
    }

    // C-496 AC-3/AC-6: when a shared visual definition was compiled at load,
    // resolve the frame through it (elapsed-time clock + actor-level
    // fallback) instead of hard-coding the 'walk' row. The resolved frame
    // maps back to a cached spritesheet key so steady playback still
    // allocates no new render objects.
    if (layer.definition) {
      const clipName = controller.isIdle ? `idle.${directionName}` : `walk.${directionName}`;
      const resolved = resolveDefinitionFrameAtTime({
        definition: layer.definition,
        clipName,
        elapsedMs: controller.elapsedMs,
      });
      if (resolved) {
        const frame = resolved.frame;
        const geometry = resolveLpcSheetGeometry(layer.texture);
        const frameCol = Math.floor(frame.x / geometry.pitch);
        const frameRow = Math.floor(frame.y / geometry.pitch);
        if (layer.spritesheet) {
          const frameTexture = layer.spritesheet.textures[`walk_${frameRow}_${frameCol}`];
          if (frameTexture) {
            layer.sprite.texture = frameTexture;
            continue;
          }
        } else if (textureManager) {
          const frameTexture = textureManager.getFrameAt({
            texture: layer.texture,
            layout: {
              frameWidth: geometry.pitch,
              frameHeight: geometry.pitch,
              columns: geometry.columns,
              rows: geometry.rows,
            },
            frameIndex: frameRow * geometry.columns + frameCol,
          });
          if (frameTexture) {
            layer.sprite.texture = frameTexture;
            continue;
          }
        }
      }
      // Fall through to the legacy row/column path if the definition path
      // could not slice a texture.
    }

    // C-428: resolve sheet geometry from the loaded texture dimensions
    const geometry = resolveLpcSheetGeometry(layer.texture);
    const columns = geometry.columns;
    const pitch = geometry.pitch;

    // C-428: use the real per-sheet column count, not a global constant
    const column = controller.getFrameColumn(columns);

    // C-168: prefer the parsed Spritesheet for WebGPU-safe UV lookups.
    // Fall back to getFrameAt when no spritesheet was created
    // (e.g., dimensions don't align to the standard grid).
    if (layer.spritesheet) {
      const rows = geometry.rows;
      const effectiveRow = rows === 1 ? 0 : row;
      const frameTexture = layer.spritesheet.textures[`walk_${effectiveRow}_${column % columns}`];
      if (frameTexture) {
        layer.sprite.texture = frameTexture;
      }
    } else if (textureManager) {
      // Legacy fallback — manual frame slicing via Rectangle.
      // Kept for spritesheets that don't conform to the standard LPC grid.
      const rows = geometry.rows;
      const effectiveRow = rows === 1 ? 0 : row;
      const dynamicFrameIndex = effectiveRow * columns + (column % columns);
      const frameTexture = textureManager.getFrameAt({
        texture: layer.texture,
        layout: { frameWidth: pitch, frameHeight: pitch, columns, rows },
        frameIndex: dynamicFrameIndex,
      });
      if (frameTexture) {
        layer.sprite.texture = frameTexture;
      }
    }
  }
};
