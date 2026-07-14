// packages/frontend/engine/src/rendering/scene_background.ts
//
// SceneBackground — background crossfade container for the PixiJS
// render pipeline. Loads textures from manifest tags, applies alpha
// crossfade transitions between old and new backgrounds.
//
// Contract: C-243

import { Assets, Container, Sprite, Texture } from 'pixi.js';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration of the crossfade tween in milliseconds. */
const CROSSFADE_DURATION_MS = 500;

/** Fallback background color when no texture is available. */
const FALLBACK_COLOR = 0x1a1a2e;

/** Tween interpolation: linear. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackgroundTweenState = {
  /** Current active background sprite (alpha = 1). */
  current: Sprite | null;
  /** Incoming background sprite being faded in. */
  incoming: Sprite | null;
  /** Outgoing background sprite being faded out. */
  outgoing: Sprite | null;
  /** Tween progress from 0 to 1. 1 = complete. */
  progress: number;
  /** Whether a tween is currently active. */
  isAnimating: boolean;
  /** Elapsed time in ms since tween started. */
  elapsed: number;
};

export type SceneBackgroundOptions = {
  /** PixiJS container to add the background below. */
  parent: Container;
  /** Index at which to insert the background layer (0 = bottom). */
  insertAt?: number;
};

// ---------------------------------------------------------------------------
// SceneBackground
// ---------------------------------------------------------------------------

export class SceneBackground {
  /** Container holding all background sprites. */
  private readonly _container: Container;

  /** Per-frame tween state. */
  private _state: BackgroundTweenState;

  /** Resolver function: tag → URL (null if not found). */
  private _resolveUrl: (tag: string) => string | null;

  /** Fallback solid-color sprite for missing tags. */
  private _fallbackSprite: Sprite | null = null;

  constructor(options: SceneBackgroundOptions) {
    const { parent, insertAt = 0 } = options;

    this._container = new Container();
    this._container.label = 'scene-background';
    parent.addChildAt(this._container, Math.min(insertAt, parent.children.length));

    this._state = {
      current: null,
      incoming: null,
      outgoing: null,
      progress: 1,
      isAnimating: false,
      elapsed: 0,
    };

    this._resolveUrl = () => null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Sets the URL resolver function (typically bound to AssetStore.resolveUrl).
   *
   * Must be called before {@link setBackground} to enable tag→URL resolution.
   *
   * @param resolver - Function that takes a manifest tag and returns a URL.
   */
  setResolver(resolver: (tag: string) => string | null): void {
    this._resolveUrl = resolver;
  }

  /**
   * Initiates a crossfade to a new background identified by a manifest tag.
   *
   * If a crossfade is already in progress, it is cancelled and the new
   * background immediately starts fading in. The old outgoing sprite is
   * removed from the stage.
   *
   * If the tag is not found, falls back to a solid dark gray color.
   *
   * @param tag - Manifest tag (e.g. "backgrounds:fantasy:dark-forest"),
   *   or null/empty to clear to the fallback color.
   */
  async setBackground(tag: string | null): Promise<void> {
    const url = tag ? this._resolveUrl(tag) : null;

    let texture: Texture;

    if (url) {
      try {
        texture = await Assets.load<Texture>(url);
      } catch (err) {
        logger.warn('SceneBackground: failed to load texture', { tag, url, err });
        texture = this._getFallbackTexture();
      }
    } else {
      if (!tag) {
        logger.debug('SceneBackground: clearing background');
      } else {
        logger.warn('SceneBackground: tag not found in manifest', { tag });
      }
      texture = this._getFallbackTexture();
    }

    this._startCrossfade(texture);
  }

  /**
   * Updates the crossfade animation. Call once per frame from the PixiJS
   * ticker or render loop.
   *
   * @param deltaMs - Milliseconds since last frame.
   */
  update(deltaMs: number): void {
    if (!this._state.isAnimating) {
      return;
    }

    this._state.elapsed += deltaMs;
    const progress = Math.min(this._state.elapsed / CROSSFADE_DURATION_MS, 1);
    this._state.progress = progress;

    // Fade out old background, fade in new
    if (this._state.outgoing) {
      this._state.outgoing.alpha = lerp(1, 0, progress);
    }

    if (this._state.incoming) {
      this._state.incoming.alpha = lerp(0, 1, progress);
    }

    // Tween complete
    if (progress >= 1) {
      this._completeTween();
    }
  }

  /**
   * Returns the PixiJS container for the background layer.
   * The container sits at the bottom of the parent's display list.
   */
  get container(): Container {
    return this._container;
  }

  /**
   * Resizes the fallback background to fill the given dimensions.
   *
   * @param width - Viewport width.
   * @param height - Viewport height.
   */
  resize(width: number, height: number): void {
    if (this._fallbackSprite) {
      this._fallbackSprite.width = width;
      this._fallbackSprite.height = height;
    }

    for (const sprite of [this._state.current, this._state.incoming, this._state.outgoing]) {
      if (sprite && sprite.texture !== Texture.WHITE) {
        sprite.width = width;
        sprite.height = height;
      }
    }
  }

  /**
   * Destroys all sprites and the container.
   */
  destroy(): void {
    this._cancelTween();

    if (this._state.current) {
      this._state.current.destroy();
      this._state.current = null;
    }

    if (this._fallbackSprite) {
      this._fallbackSprite.destroy();
      this._fallbackSprite = null;
    }

    this._container.destroy({ children: true });
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Returns a fallback solid-color texture (256×4 dark gray).
   */
  private _getFallbackTexture(): Texture {
    // Create a simple fallback sprite once and reuse it
    if (!this._fallbackSprite) {
      this._fallbackSprite = new Sprite(Texture.WHITE);
      this._fallbackSprite.tint = FALLBACK_COLOR;
      this._fallbackSprite.width = 800;
      this._fallbackSprite.height = 600;
    }
    return this._fallbackSprite.texture;
  }

  /**
   * Starts (or restarts) a background crossfade.
   */
  private _startCrossfade(texture: Texture): void {
    // Cancel any in-progress tween — remove outgoing sprite
    this._cancelTween();

    // The current background becomes the outgoing one
    if (this._state.current) {
      this._state.outgoing = this._state.current;
      this._state.outgoing.alpha = 1;
    }

    // Create the incoming sprite
    const incoming = new Sprite(texture);
    incoming.alpha = 0;
    incoming.width =
      (this._container.parent as { screen?: { width: number } }).screen?.width ?? 800;
    incoming.height =
      (this._container.parent as { screen?: { height: number } }).screen?.height ?? 600;

    this._container.addChild(incoming);
    this._state.incoming = incoming;
    this._state.current = incoming;

    // Start the tween
    this._state.elapsed = 0;
    this._state.progress = 0;
    this._state.isAnimating = true;
  }

  /**
   * Cancels the current tween and removes the outgoing sprite.
   */
  private _cancelTween(): void {
    if (this._state.outgoing) {
      this._container.removeChild(this._state.outgoing);
      this._state.outgoing.destroy();
      this._state.outgoing = null;
    }

    if (this._state.incoming && this._state.incoming !== this._state.current) {
      this._container.removeChild(this._state.incoming);
      this._state.incoming.destroy();
      this._state.incoming = null;
    }

    this._state.elapsed = 0;
    this._state.progress = 1;
    this._state.isAnimating = false;
  }

  /**
   * Called when the crossfade tween completes.
   */
  private _completeTween(): void {
    this._state.isAnimating = false;
    this._state.progress = 1;

    // Remove and destroy the outgoing sprite
    if (this._state.outgoing) {
      this._container.removeChild(this._state.outgoing);
      this._state.outgoing.destroy();
      this._state.outgoing = null;
    }

    // Ensure incoming is fully opaque
    if (this._state.incoming) {
      this._state.incoming.alpha = 1;
    }
  }
}
