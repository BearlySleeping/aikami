// apps/frontend/client/src/lib/services/assets/blob_url_loader.ts
//
// C-373: PixiJS load parser for `blob:` object URLs.
//
// The AssetManager hands the engine content-hash-keyed blob: URLs so cached
// binaries bypass the network. PixiJS's texture loaders select parsers by URL
// file extension — a `blob:http://…/<uuid>` URL has none, so the default
// loader rejects it. This parser teaches Assets.load() to fetch the blob URL
// and decode it as a texture (WebP/PNG handled via createImageBitmap).
//
// Registered at module scope so it exists before any Assets.load() call.

// Also register the custom-scheme (tauri://, file://) URL resolve parser so
// root-relative /game-data paths resolve to absolute URLs before PixiJS's
// path utilities mis-parse the tauri:// origin. Idempotent.
import '@aikami/frontend/engine/assets/custom_scheme_url_resolver.ts';

import { ExtensionType, extensions, LoaderParserPriority, Texture } from 'pixi.js';

/** Whether the parser has been registered (idempotent guard). */
let _registered = false;

/** Registers the blob: URL texture parser exactly once. */
const _register = (): void => {
  if (_registered) {
    return;
  }
  _registered = true;

  extensions.add({
    name: 'loadBlobUrlTexture',
    extension: {
      type: ExtensionType.LoadParser,
      priority: LoaderParserPriority.High,
    },
    test: (url: string): boolean => url.startsWith('blob:'),
    load: async (url: string): Promise<Texture> => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Blob URL fetch failed: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      // createImageBitmap preserves the image's alpha/format; fall back to
      // Texture.from(blob) where ImageBitmap is unavailable.
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        try {
          const texture = Texture.from(bitmap);
          texture.source.scaleMode = 'nearest';
          return texture;
        } catch (error) {
          // Never leak the ImageBitmap if texture creation/config fails.
          bitmap.close();
          throw error;
        }
      }
      const objectUrl = URL.createObjectURL(blob);
      const texture = Texture.from(objectUrl);
      texture.source.scaleMode = 'nearest';
      // Revoke the object URL after the texture has loaded its source.
      texture.source.once('destroy', () => URL.revokeObjectURL(objectUrl));
      return texture;
    },
    unload: (texture: Texture): void => {
      texture.destroy(true);
    },
  });
};

_register();

/**
 * Ensures the blob: URL texture parser is registered.
 *
 * Module-scope registration happens on import; this export exists for
 * explicit initialization paths and tests.
 */
export const registerBlobUrlTextureParser = (): void => {
  _register();
};
