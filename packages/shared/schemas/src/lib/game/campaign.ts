// packages/shared/schemas/src/lib/campaign.ts
//
// Campaign aggregate schema — the canonical data shape for a game campaign.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

import Type, { type Static } from 'typebox';

/** Valid campaign boot states. */
export const CampaignStateSchema = Type.Union([
  Type.Literal('idle'),
  Type.Literal('creating'),
  Type.Literal('loading'),
  Type.Literal('playing'),
  Type.Literal('paused'),
  Type.Literal('saving'),
  Type.Literal('failed'),
]);

export type CampaignState = Static<typeof CampaignStateSchema>;

/** AI capability profile recorded at campaign creation time. */
export const CapabilityProfileSchema = Type.Object({
  textProvider: Type.Boolean({ description: 'Whether a text AI provider is available' }),
  imageProvider: Type.Boolean({ description: 'Whether an image AI provider is available' }),
  voiceProvider: Type.Boolean({ description: 'Whether a voice AI provider is available' }),
});

export type CapabilityProfile = Static<typeof CapabilityProfileSchema>;

/** A single game campaign — the aggregate root for all campaign-scoped state. */
export const CampaignSchema = Type.Object({
  /** Unique campaign identifier (UUID v4). */
  id: Type.String({ description: 'Unique campaign identifier' }),
  /** Display name — defaults to "New Adventure" until the player names it. */
  name: Type.String({ description: 'Display name' }),
  /** Current boot state machine state. */
  state: CampaignStateSchema,
  /** ID of the selected persona, if one has been chosen. */
  personaId: Type.Optional(Type.String({ description: 'ID of the selected persona' })),
  /** Content pack identifier — defaults to 'emberwatch' for Phase 1. */
  contentPackId: Type.String({ description: 'Content pack identifier' }),
  /** Deterministic seed for RNG replayability. Generated at campaign creation. */
  seed: Type.Number({ description: 'Deterministic RNG seed' }),
  /** ISO timestamp of campaign creation. */
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
  /** ISO timestamp of last state mutation. */
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
  /** ISO timestamp of last save, or undefined if never saved. */
  lastSavedAt: Type.Optional(
    Type.String({ format: 'date-time', description: 'Last save timestamp' }),
  ),
  /** Reference to the most recent save slot ID. */
  lastSaveSlotId: Type.Optional(Type.String({ description: 'Last save slot ID' })),
  /** AI capability profile recorded at campaign creation. */
  capabilityProfile: CapabilityProfileSchema,
});

export type Campaign = Static<typeof CampaignSchema>;
