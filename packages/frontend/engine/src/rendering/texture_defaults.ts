// packages/frontend/engine/src/rendering/texture_defaults.ts
//
// Contract C-377 AC-1 — global nearest-neighbour filtering default.
//
// Pixel-art games must sample textures with nearest-neighbour filtering,
// never bilinear. PixiJS v8 defaults every `TextureSource` to `'linear'`
// (`TextureStyle.defaultOptions.scaleMode`). Rather than patching each
// texture load site (which a future loader can forget), this module is
// the ONE place the default is changed.
//
// `pixi_app.ts` calls `installNearestTextureDefault()` at renderer
// creation, before any `Assets.load` — so every texture created for the
// life of the application inherits nearest filtering. Existing per-site
// assignments (`texture.source.scaleMode = 'nearest'`) remain in place;
// they are redundant but harmless.
//
// Kept in a config-free module so engine tests can exercise the identical
// production default without the `@aikami/frontend-configs` env bootstrap.

import { TextureStyle } from 'pixi.js';

/**
 * Installs nearest-neighbour as the global texture sampling default.
 *
 * Idempotent — safe to call multiple times (e.g. from `createPixiApp`
 * and from test setup). All `TextureSource` instances created after this
 * call sample with nearest filtering unless explicitly overridden.
 */
export const installNearestTextureDefault = (): void => {
  TextureStyle.defaultOptions.scaleMode = 'nearest';
};
