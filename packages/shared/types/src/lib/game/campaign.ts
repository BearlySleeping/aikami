// packages/shared/types/src/lib/game/campaign.ts
//
// Re-exports from @aikami/schemas — source of truth for campaign types.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

import type { AppError } from '../common/error.ts';

export type {
  Campaign,
  CampaignState,
  CapabilityProfile,
} from '@aikami/schemas';

/** Error thrown when text AI provider is required but not available. */
export type AiTextProviderRequiredError = AppError & {
  readonly code: 'text-provider-required';
};
