// apps/frontend/client/src/lib/views/session/session_browser_composition.ts
//
// Production wiring for the Session Browser feature. This is the only module in
// the feature that imports the production `$services`/router singletons; the
// ViewModel receives its dependencies as typed capabilities.

import { routerService } from '@aikami/frontend/services';
import { sessionService } from '$services/game/session_service.svelte';
import {
  createSessionBrowserViewModel,
  type SessionBrowserViewModelInterface,
  type SessionBrowserViewModelOptions,
} from './session_browser_view_model.svelte';

/**
 * Builds the session-browser ViewModel wired to the production session service
 * and router.
 */
export const getSessionBrowserViewModel = (
  options: Omit<SessionBrowserViewModelOptions, 'session' | 'router'>,
): SessionBrowserViewModelInterface =>
  createSessionBrowserViewModel({
    ...options,
    session: sessionService,
    router: routerService,
  });
