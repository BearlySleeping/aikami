// apps/frontend/client/src/lib/views/dev/session_sandbox_composition.ts
//
// Production wiring for the session-management dev sandbox. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives its dependencies as typed capabilities, so unit tests never touch
// the global service registry.

import { sessionService } from '$services';
import {
  createSessionSandboxViewModel,
  type SessionSandboxViewModelInterface,
  type SessionSandboxViewModelOptions,
} from './session_sandbox_view_model.svelte';

/**
 * Builds the session-sandbox ViewModel wired to the production session
 * singleton.
 */
export const getSessionSandboxViewModel = (
  options: Omit<SessionSandboxViewModelOptions, 'session'>,
): SessionSandboxViewModelInterface =>
  createSessionSandboxViewModel({ ...options, session: sessionService });
