// apps/frontend/client/src/lib/views/settings/ai/ai_capability_badge_view_model.svelte.ts
//
// Lightweight ViewModel for the Settings header's AI capability badge. It reads
// the shared connection-test status and nothing else — so rendering the header
// no longer constructs the full AI settings editor (with its drafts, modal
// state, and provider requests).

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AiCapabilityStatus } from './ai_connection_status.svelte';

export type AiCapabilityBadgeViewModelInterface = BaseViewModelInterface & {
  /** e.g. "AI: Connected" / "AI: Partial" / "AI: Not Set Up". */
  readonly label: string;
  /** Aikami UI badge class, e.g. `badge-success`. */
  readonly color: string;
};

export type AiCapabilityBadgeViewModelOptions = BaseViewModelOptions & {
  /** Injected status source — keeps this module free of production imports. */
  getCapabilityStatuses: () => readonly AiCapabilityStatus[];
};

class AiCapabilityBadgeViewModel
  extends BaseViewModel<AiCapabilityBadgeViewModelOptions>
  implements AiCapabilityBadgeViewModelInterface
{
  private readonly _getCapabilityStatuses: () => readonly AiCapabilityStatus[];

  constructor(options: AiCapabilityBadgeViewModelOptions) {
    super(options);
    this._getCapabilityStatuses = options.getCapabilityStatuses;
  }

  get label(): string {
    const entries = this._getCapabilityStatuses();
    const textEntry = entries.find((entry) => entry.capability === 'text');
    if (textEntry?.status === 'reachable') {
      return 'AI: Connected';
    }
    if (entries.some((entry) => entry.status === 'reachable')) {
      return 'AI: Partial';
    }
    return 'AI: Not Set Up';
  }

  get color(): string {
    const entries = this._getCapabilityStatuses();
    const textEntry = entries.find((entry) => entry.capability === 'text');
    if (textEntry?.status === 'reachable') {
      return 'badge-success';
    }
    if (entries.some((entry) => entry.status === 'reachable')) {
      return 'badge-warning';
    }
    return 'badge-ghost';
  }
}

/**
 * Testable factory — no production imports. Production wiring (configService +
 * the shared status store) lives in ./ai_capability_badge_composition.ts.
 */
export const createAiCapabilityBadgeViewModel = (
  options: AiCapabilityBadgeViewModelOptions,
): AiCapabilityBadgeViewModelInterface => AiCapabilityBadgeViewModel.create(options);
