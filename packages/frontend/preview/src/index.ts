// packages/frontend/preview/src/index.ts
//
// Static preview components — no engine dependency.
// Hosts import from this entrypoint for LPC, tileset, prop, and map previews.

export { default as LpcPreview } from './lib/lpc/lpc_preview.svelte';
export { default as TilesetPreview } from './lib/tileset/tileset_preview.svelte';
export { default as PropPreview } from './lib/prop/prop_preview.svelte';
export { default as MapPreview } from './lib/map/map_preview.svelte';

export { createLpcRenderer, detectLpcSheetLayout, getLpcSpriteAnchor, type LpcRenderer, type LpcSheetLayout } from './lib/lpc/lpc_renderer';
export {
  encodeLpcPreviewState,
  decodeLpcPreviewState,
  type LpcPreviewState,
} from './lib/lpc/preview_url_state';
export type { PreviewProps } from './lib/types';
export type { LpcSlotDef } from '@aikami/lpc';
export type { LpcPreviewViewModelInterface } from './lib/lpc/lpc_preview_view_model.svelte';
export {
  getLpcIconCellPitch,
  getLpcGrid,
  getLpcIconBackgroundSize,
  getLpcIconBackgroundPosition,
  pickHeroCell,
  type LpcGrid,
  type LpcIconBackgroundPositionOptions,
  type PickHeroCellOptions,
} from './lib/lpc/lpc_icon_frame';
export type { MapPreviewViewModelInterface } from './lib/map/map_preview_view_model.svelte';
export type { PropPreviewViewModelInterface } from './lib/prop/prop_preview_view_model.svelte';
export type { TilesetPreviewViewModelInterface } from './lib/tileset/tileset_preview_view_model.svelte';
