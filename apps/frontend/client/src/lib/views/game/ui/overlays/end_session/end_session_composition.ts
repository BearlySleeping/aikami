// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_composition.ts
//
// Production wiring for the end-session overlay. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { gameOverlayService, sessionService } from '$services';
import {
  createEndSessionViewModel,
  type EndSessionViewModelInterface,
} from './end_session_view_model.svelte';

/**
 * Builds the end-session ViewModel wired to the production overlay and session
 * singletons.
 */
export const getEndSessionViewModel = (
  options: BaseViewModelOptions,
): EndSessionViewModelInterface =>
  createEndSessionViewModel({
    ...options,
    overlay: gameOverlayService,
    session: sessionService,
  });
