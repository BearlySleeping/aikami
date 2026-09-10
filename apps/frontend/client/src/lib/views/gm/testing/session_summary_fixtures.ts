// apps/frontend/client/src/lib/views/gm/testing/session_summary_fixtures.ts
//
// Feature-owned test doubles for the session-summary panel ViewModel.
// Operations are not defaulted to success: an unconfigured call throws, so a
// test cannot pass by accident on a silent no-op.

import type { SessionSummaryCapabilities } from '../session_summary_panel_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Summarization capability whose operations throw until overridden. */
export const createSessionSummaryCapabilities = (
  overrides: Partial<SessionSummaryCapabilities> = {},
): SessionSummaryCapabilities => ({
  generateSummary: () => unconfigured('generateSummary'),
  clearSummary: () => unconfigured('clearSummary'),
  ...overrides,
});
