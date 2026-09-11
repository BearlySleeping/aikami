// apps/frontend/client/src/lib/views/gallery/testing/gallery_fixtures.ts
//
// Feature-owned test doubles for the gallery ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type { GalleryCapabilities } from '../gallery_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Gallery capability with no images/removal until overridden. */
export const createGalleryCapabilities = (
  overrides: Partial<GalleryCapabilities> = {},
): GalleryCapabilities => ({
  totalCount: 0,
  getImagesForChat: () => [],
  removeImage: () => unconfigured('removeImage'),
  ...overrides,
});
