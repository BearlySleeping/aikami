// apps/frontend/client/src/lib/views/link/link_composition.ts
//
// Production wiring for the device-link handoff page. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// auth as a typed capability, so unit tests never touch the global service
// registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { authService } from '$services';
import { createLinkViewModel, type LinkViewModelInterface } from './link_view_model.svelte';

/**
 * Builds the link ViewModel wired to the production auth singleton.
 */
export const getLinkViewModel = (options: BaseViewModelOptions): LinkViewModelInterface =>
  createLinkViewModel({
    ...options,
    auth: authService,
  });
