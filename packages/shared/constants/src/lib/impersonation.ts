// packages/shared/constants/src/lib/impersonation.ts
//
// Impersonation mode constants — default prompt templates and configuration
// values for the /impersonate slash command and quick-button drafting.
//
// Contract: C-241 Chat Modes Address System

/**
 * Slash command name for impersonation drafting.
 * Typing `/impersonate [direction]` triggers the impersonation flow.
 */
export const IMPERSONATION_COMMAND = 'impersonate' as const;

const _IMPERSONATION_PROMPT_LINES = [
  'You are {{personaName}}.',
  'Personality: {{personaTraits}}',
  '',
  'Write the next message as {{personaName}}, speaking in-character.',
  'Match their voice, mannerisms, and personality. Write ONLY the message —',
  'no narration, no quotation marks wrapping the entire message.',
  '{{#direction}}',
  'Direction: {{direction}}',
  '{{/direction}}',
  '',
  'Recent context:',
  '{{recentContext}}',
] as const;

/**
 * Default system prompt template for impersonation drafting.
 *
 * Injects the active persona's name and any optional direction text.
 * The LLM is instructed to write as the persona, not as itself.
 *
 * Placeholders:
 *   {{personaName}} — The active persona character name
 *   {{personaTraits}} — Personality traits / description of the persona
 *   {{direction}} — Optional direction text (e.g. "I examine the ancient runes")
 *   {{recentContext}} — Recent chat messages for continuity
 */
export const DEFAULT_IMPERSONATION_PROMPT_TEMPLATE = _IMPERSONATION_PROMPT_LINES.join('\n');

/**
 * Fallback message shown when no active persona is found.
 */
export const NO_PERSONA_TOAST_MESSAGE =
  'Set up your persona first in the Character Sheet.' as const;

/**
 * Toast message shown when the impersonation draft is ready.
 */
export const IMPERSONATION_DRAFT_READY_TOAST = 'Draft ready! Edit and send, or discard.' as const;
