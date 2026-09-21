// apps/frontend/client/src/lib/views/gallery/gallery_composition.ts
//
// Production wiring for the image gallery panel. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives it as a
// typed capability.

import { galleryService } from '$services';
import {
  createGalleryViewModel,
  type GalleryViewModelInterface,
  type GalleryViewModelOptions,
} from './gallery_view_model.svelte';

/**
 * Builds the gallery ViewModel wired to the production gallery singleton.
 */
export const getGalleryViewModel = (
  options: Omit<GalleryViewModelOptions, 'gallery'>,
): GalleryViewModelInterface => createGalleryViewModel({ ...options, gallery: galleryService });
