// packages/frontend/preview/src/lib/types.ts
//
// Shared prop types for all preview components in the package.

import type { AssetResolver } from '@aikami/types';

/** Every preview component takes at least this. */
export type PreviewProps = {
  /** Host-supplied resolution strategy (registry, cdn, or fixture). */
  readonly resolver: AssetResolver;
  /** Rendered size in CSS pixels. */
  readonly width?: number;
  readonly height?: number;
  /** Integer upscale factor for pixel art. Defaults to 2. */
  readonly zoom?: number;
};
