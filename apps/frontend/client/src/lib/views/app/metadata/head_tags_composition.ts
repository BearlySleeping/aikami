// apps/frontend/client/src/lib/views/app/metadata/head_tags_composition.ts
//
// Production wiring for the head-tags feature. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives it as
// a typed capability.

import { routerService } from '$services';
import {
  createHeadTagsViewModel,
  type HeadTagsViewModelInterface,
  type HeadTagsViewModelOptions,
} from './head_tags_view_model.svelte';

/**
 * Builds the head-tags ViewModel wired to the production router singleton.
 */
export const getHeadTagsViewModel = (
  options: Omit<HeadTagsViewModelOptions, 'router'>,
): HeadTagsViewModelInterface =>
  createHeadTagsViewModel({
    ...options,
    router: routerService,
  });
