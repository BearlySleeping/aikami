// apps/frontend/client/src/lib/services/media/pixi_texture_injector.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { type Container, Texture } from 'pixi.js';

// ---------------------------------------------------------------------------
// PixiTextureInjector — Dynamic texture injection from binary image buffers
//
// Receives raw image buffers (e.g. from ComfyUI WebSocket), converts them
// to PixiJS Textures via createImageBitmap, and applies them to a target
// display object (Sprite or Mesh).
//
// CRITICAL: When swapping a PixiJS texture on a Sprite/Mesh, the old texture
// MUST be explicitly destroyed (`texture.destroy(true)`) to prevent GPU memory
// leaks on WebGPU — otherwise the old texture's VRAM allocation is never
// reclaimed until the app is destroyed.
// ---------------------------------------------------------------------------

export type PixiTextureInjectorOptions = BaseFrontendClassOptions & {
  /**
   * The target PixiJS Container (Sprite or Mesh) whose texture will be updated.
   * Must have a `texture` property.
   */
  target: Container & { texture: Texture };

  /**
   * MIME type to use when constructing the Blob from the binary buffer.
   * Common values: 'image/webp', 'image/png', 'image/jpeg'.
   * @default 'image/webp'
   */
  mimeType?: string;
};

export type PixiTextureInjectorInterface = BaseFrontendClassInterface & {
  /**
   * Converts a binary image buffer to a PixiJS Texture and applies it to
   * the target display object.
   *
   * Destroys the old texture (if any) before assigning the new one to
   * prevent GPU memory leaks.
   *
   * @param options.buffer — Raw image bytes (e.g. WebP, PNG, JPEG).
   * @returns Promise that resolves when the texture has been applied.
   */
  injectTexture(options: { buffer: ArrayBuffer }): Promise<void>;

  /**
   * Clears the current texture from the target, destroying the GPU resource.
   *
   * Sets the target's texture to {@link Texture.WHITE} (a shared resource
   * that should never be destroyed).
   */
  clearTexture(): void;
};

/**
 * Injects dynamically generated image textures into a PixiJS display object.
 *
 * Uses {@link createImageBitmap} for efficient GPU-friendly image decoding
 * and properly manages texture lifecycle to prevent VRAM leaks.
 *
 * The `target` must be a PixiJS Container subclass that exposes a `texture`
 * property. In practice this is typically a `Sprite` or mesh type.
 *
 * @example
 * ```typescript
 * const injector = new PixiTextureInjector({
 *   className: 'NpcPortrait',
 *   target: npcSprite,
 *   mimeType: 'image/webp',
 * });
 *
 * await injector.injectTexture({ buffer: comfyUiImageBuffer });
 * ```
 */
export class PixiTextureInjector
  extends BaseFrontendClass<PixiTextureInjectorOptions>
  implements PixiTextureInjectorInterface
{
  private readonly _target: Container & { texture: Texture };
  private readonly _mimeType: string;
  private _currentTexture: Texture | undefined;

  constructor(options: PixiTextureInjectorOptions) {
    super(options);
    this._target = options.target;
    this._mimeType = options.mimeType ?? 'image/webp';
  }

  async injectTexture(options: { buffer: ArrayBuffer }): Promise<void> {
    const { buffer } = options;

    this.debug('injectTexture', {
      byteLength: buffer.byteLength,
      mimeType: this._mimeType,
    });

    // Convert binary buffer → Blob → ImageBitmap
    const blob = new Blob([buffer], { type: this._mimeType });

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      this.error('createImageBitmap failed', error);
      throw new Error(`Failed to decode image buffer: ${String(error)}`);
    }

    // Create a new PixiJS Texture from the ImageBitmap
    const newTexture = Texture.from(bitmap);

    // 🔴 CRITICAL: Destroy the old texture to prevent WebGPU memory leaks.
    // Texture.WHITE is a global singleton that should never be destroyed.
    if (this._currentTexture && this._currentTexture !== Texture.WHITE) {
      this.debug('destroying previous texture');
      this._currentTexture.destroy(true);
    }

    this._currentTexture = newTexture;
    this._target.texture = newTexture;

    // Notify the renderer that the texture has changed.
    // Required in PixiJS v8 for UV recalculations when the texture source
    // or dimensions change between swaps.
    const targetWithUpdate = this._target as Container & {
      texture: Texture;
      onViewUpdate?: () => void;
    };
    if (typeof targetWithUpdate.onViewUpdate === 'function') {
      targetWithUpdate.onViewUpdate();
    }

    // Close the bitmap to free CPU-side pixel data (GPU copy is already uploaded)
    bitmap.close();
  }

  clearTexture(): void {
    if (this._currentTexture && this._currentTexture !== Texture.WHITE) {
      this._currentTexture.destroy(true);
    }

    this._currentTexture = undefined;
    this._target.texture = Texture.WHITE;

    const targetWithUpdate = this._target as Container & {
      texture: Texture;
      onViewUpdate?: () => void;
    };
    if (typeof targetWithUpdate.onViewUpdate === 'function') {
      targetWithUpdate.onViewUpdate();
    }
  }

  override async dispose(): Promise<void> {
    this.clearTexture();
    await super.dispose();
  }
}

export const getPixiTextureInjector = (
  options: PixiTextureInjectorOptions,
): PixiTextureInjectorInterface => PixiTextureInjector.create(options);
