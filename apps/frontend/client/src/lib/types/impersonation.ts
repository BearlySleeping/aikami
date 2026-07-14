// apps/frontend/client/src/lib/types/impersonation.ts
//
// Client-local types for the impersonation drafting system.
// These are UI-layer configuration values — not cross-boundary data —
// so they live in the app's local types, not shared packages.
//
// Contract: C-241 Chat Modes Address System

/**
 * Per-chat impersonation configuration.
 *
 * Stored client-side (local state) — no backend persistence.
 * Controls the availability and behavior of the impersonation
 * drafting tool in the chat input area.
 */
export type ImpersonationConfig = {
  /** Whether the 🎭 impersonate quick-button is visible in the chat input bar. */
  quickButtonEnabled: boolean;

  /** Custom prompt template override. Empty string = use built-in default. */
  promptTemplate: string;

  /** Whether to skip the agent pipeline during impersonation generation. */
  skipAgents: boolean;
};
