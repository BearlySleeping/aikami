// apps/frontend/client/src/lib/views/settings/ai/ai_activity_view_model.svelte.ts
//
// ViewModel for the AI Activity settings section. Projects the task→role
// routing table and the rolling text-telemetry buffer for display; all data
// arrives through typed capabilities so tests never touch service singletons.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AiConnection, RoleAssignments } from '@aikami/types';
import type { TextTelemetryServiceInterface } from '$services';
import type { TextTelemetrySpan, TextTelemetrySummary } from '$types';
import { buildTaskRoutingRows, type TaskRoutingRow } from './ai_roles';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Config surface the task-routing table reads. */
export type AiActivityConfigCapabilities = {
  getAiConnections(): readonly AiConnection[];
  getRoleAssignments(): RoleAssignments;
};

/** Telemetry surface the activity list reads (narrowed from the service). */
export type AiActivityTelemetryCapabilities = Pick<
  TextTelemetryServiceInterface,
  'spans' | 'summary' | 'clear'
>;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type AiActivityViewModelInterface = BaseViewModelInterface & {
  /** Task → role → connection projection. */
  readonly taskRoutingRows: readonly TaskRoutingRow[];
  /** Recent text-generation spans, newest first. */
  readonly activitySpans: ReadonlyArray<TextTelemetrySpan>;
  /** Aggregate stats over the current buffer. */
  readonly activitySummary: TextTelemetrySummary;
  /** Clears the activity buffer. */
  clearActivity(): void;
};

export type AiActivityViewModelOptions = BaseViewModelOptions & {
  config: AiActivityConfigCapabilities;
  telemetry: AiActivityTelemetryCapabilities;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AiActivityViewModel
  extends BaseViewModel<AiActivityViewModelOptions>
  implements AiActivityViewModelInterface
{
  private readonly _config: AiActivityConfigCapabilities;
  private readonly _telemetry: AiActivityTelemetryCapabilities;

  constructor(options: AiActivityViewModelOptions) {
    super(options);
    this._config = options.config;
    this._telemetry = options.telemetry;
  }

  get taskRoutingRows(): readonly TaskRoutingRow[] {
    return buildTaskRoutingRows({
      connections: this._config.getAiConnections(),
      assignments: this._config.getRoleAssignments(),
    });
  }

  get activitySpans(): ReadonlyArray<TextTelemetrySpan> {
    return this._telemetry.spans;
  }

  get activitySummary(): TextTelemetrySummary {
    return this._telemetry.summary;
  }

  clearActivity(): void {
    this._telemetry.clear();
  }
}

/**
 * Testable factory — no production imports. Production wiring lives in
 * ./ai_activity_composition.ts.
 */
export const createAiActivityViewModel = (
  options: AiActivityViewModelOptions,
): AiActivityViewModelInterface => AiActivityViewModel.create(options);
