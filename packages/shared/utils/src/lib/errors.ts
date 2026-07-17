// packages/shared/utils/src/lib/errors.ts
//
// Error classes for shared error types.
// Contract: C-323 Enforce the Mandatory Text AI Capability Gate

import type { AiTextProviderRequiredError as AiTextProviderRequiredErrorType } from '@aikami/types';

/**
 * Error thrown when text AI provider is required but not available.
 * Satisfies the {@link AiTextProviderRequiredErrorType} contract from @aikami/types.
 */
export class AiTextProviderRequiredError
  extends Error
  implements Omit<AiTextProviderRequiredErrorType, 'cause'>
{
  readonly code = 'text-provider-required' as const;

  constructor(message = 'A text AI provider is required to start a campaign.') {
    super(message);
    this.name = 'AiTextProviderRequiredError';
  }
}

/**
 * Type guard for {@link AiTextProviderRequiredError}.
 */
export const isAiTextProviderRequiredError = (
  error: unknown,
): error is AiTextProviderRequiredError => error instanceof AiTextProviderRequiredError;
