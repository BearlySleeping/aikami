// apps/frontend/client/src/lib/services/campaign/boot_state_machine.ts
//
// Pure state machine for campaign lifecycle transitions.
// No side effects, no external dependencies — fully testable in isolation.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

// biome-ignore-all lint/style/useNamingConvention: event type discriminators use SCREAMING_SNAKE_CASE by design

import type { CampaignState } from '@aikami/types';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/** Events that can trigger a campaign state transition. */
export type CampaignStateEvent =
  | { type: 'START_NEW' }
  | { type: 'PERSONA_SELECTED'; personaId: string }
  | { type: 'SETUP_COMPLETE' }
  | { type: 'LOAD_REQUESTED'; campaignId: string }
  | { type: 'LOAD_COMPLETE' }
  | { type: 'LOAD_FAILED'; error: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SAVE_REQUESTED' }
  | { type: 'SAVE_COMPLETE' }
  | { type: 'SAVE_FAILED'; error: string };

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Maps (currentState, eventType) → nextState.
 * Events not listed for a state are invalid and will throw.
 */
const TRANSITIONS: Record<
  CampaignState,
  Partial<Record<CampaignStateEvent['type'], CampaignState>>
> = {
  idle: {
    START_NEW: 'creating',
    LOAD_REQUESTED: 'loading',
  },
  creating: {
    PERSONA_SELECTED: 'creating',
    SETUP_COMPLETE: 'playing',
  },
  loading: {
    LOAD_COMPLETE: 'playing',
    LOAD_FAILED: 'failed',
  },
  playing: {
    PAUSE: 'paused',
    SAVE_REQUESTED: 'saving',
  },
  paused: {
    RESUME: 'playing',
    SAVE_REQUESTED: 'saving',
  },
  saving: {
    SAVE_COMPLETE: 'playing',
    SAVE_FAILED: 'failed',
  },
  failed: {
    START_NEW: 'creating',
    LOAD_REQUESTED: 'loading',
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes the next campaign state given the current state and an event.
 *
 * Pure function — always returns the same result for the same inputs.
 * Throws on invalid transitions.
 *
 * @param current - The current campaign state
 * @param event - The event to process
 * @returns The next campaign state
 * @throws If the transition is invalid for the current state
 */
export const transition = (current: CampaignState, event: CampaignStateEvent): CampaignState => {
  const next = TRANSITIONS[current]?.[event.type];
  if (next === undefined) {
    throw new Error(`Invalid transition: cannot ${event.type} from state "${current}"`);
  }
  return next;
};

/**
 * Returns whether an event is valid for the given state without transitioning.
 * Useful for UI guards (e.g., disabling a button if the action isn't available).
 */
export const canTransition = (current: CampaignState, event: CampaignStateEvent): boolean => {
  return event.type in (TRANSITIONS[current] ?? {});
};
