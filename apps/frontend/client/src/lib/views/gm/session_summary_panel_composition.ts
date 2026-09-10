// apps/frontend/client/src/lib/views/gm/session_summary_panel_composition.ts
//
// Production wiring for the End Session summary panel. This is the only module
// in the feature that imports the `$services` singleton; the ViewModel receives
// it as a typed capability.

import { sessionSummaryService } from '$services';
import {
  createSessionSummaryPanelViewModel,
  type SessionSummaryPanelViewModelInterface,
  type SessionSummaryPanelViewModelOptions,
} from './session_summary_panel_view_model.svelte';

/**
 * Builds the session-summary panel ViewModel wired to the production
 * summarization singleton.
 */
export const getSessionSummaryPanelViewModel = (
  options: Omit<SessionSummaryPanelViewModelOptions, 'summary'>,
): SessionSummaryPanelViewModelInterface =>
  createSessionSummaryPanelViewModel({ ...options, summary: sessionSummaryService });
