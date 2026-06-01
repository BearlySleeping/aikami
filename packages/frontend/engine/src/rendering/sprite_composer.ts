// packages/frontend/engine/src/rendering/sprite_composer.ts
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { TextureManager } from './texture_manager.ts';

// ---------------------------------------------------------------------------
// SpriteComposer — dynamic sprite layering + cacheAsTexture flattening
// ---------------------------------------------------------------------------

/** Placeholder dimensions and colour. */
const PLACEHOLDER_SIZE = 32;
const PLACEHOLDER_COLOR = 0x444444;

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
 * Composes layered sprites for an entity from numeric asset IDs.
 *
 * Each entity that has an `Appearance` component gets a PixiJS `Container`
 * managed by this composer. The composer returns a placeholder container
 * immediately, then asynchronously loads each non-zero layer texture.
 * Once all textures resolve, the placeholder is replaced with properly
 * layered `Sprite` objects and the container is flattened into a cached
 * GPU texture via `cacheAsTexture`.
 */
export class SpriteComposer {
  /** Texture cache used to fetch / cache individual layer textures. */
  private readonly textureManager: TextureManager;

  /**
   * @param textureManager - The shared texture cache.
   */
  constructor(textureManager: TextureManager) {
    this.textureManager = textureManager;
  }

  /**
   * Creates a container for an entity and immediately starts async texture
   * loading.
   *
   * The returned container initially holds a grey placeholder rectangle.
   * When all layer textures resolve, the placeholder is replaced with
   * sprites stacked in order (layer0 at the bottom, layer4 on top) and
   * the container is flattened with `cacheAsTexture = true`.
   *
   * @param options - Composition options.
   * @param options.layerIds - Array of numeric asset IDs (0 = no asset).
   * @returns A PixiJS `Container` ready for addition to the stage.
   */
  composeSprite(options: { layerIds: readonly number[] }): Container {
    const { layerIds } = options;
    const container = new Container();
    const placeholder = addPlaceholder(container);

    // Kick off async loading — intentionally fire-and-forget; the
    // container is already on the stage holding the placeholder.
    this.loadAndCompose(container, placeholder, layerIds);

    return container;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Loads textures for all non-zero layer IDs and replaces the placeholder
   * with composed sprites.
   */
  private async loadAndCompose(
    container: Container,
    placeholder: Graphics,
    layerIds: readonly number[],
  ): Promise<void> {
    const activeIds = layerIds.filter((id) => id > 0);

    if (activeIds.length === 0) {
      // No layers to load — keep placeholder, but mark as cached.
      container.cacheAsTexture(true);
      return;
    }

    try {
      const textures: Texture[] = await Promise.all(
        activeIds.map((id) => this.textureManager.getTexture(id)),
      );

      // Remove placeholder
      container.removeChild(placeholder);
      placeholder.destroy();

      // Add sprites in layer order (index 0 = bottom, index n = top).
      for (const texture of textures) {
        const sprite = new Sprite(texture);
        container.addChild(sprite);
      }

      // Flatten the composed layers into a single cached GPU texture.
      container.cacheAsTexture(true);
    } catch {
      // Keep the placeholder on failure — the entity is still visible.
      container.cacheAsTexture(true);
    }
  }
}
