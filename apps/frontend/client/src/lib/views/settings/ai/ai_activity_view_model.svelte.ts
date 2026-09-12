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
// Display projections
// ---------------------------------------------------------------------------

/** One activity span, formatted for the view. */
export type AiActivityRow = {
  id: number;
  taskLabel: string;
  modelLabel: string;
  totalLabel: string;
  ttftLabel: string;
  tokenLabel: string;
  showError: boolean;
};

/** One per-task activity aggregate, formatted for the view. */
export type AiActivityTaskRow = {
  task: string;
  count: number;
  medianTotalLabel: string;
  medianTtftLabel: string;
  errorCount: number;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type AiActivityViewModelInterface = BaseViewModelInterface & {
  /** Task → role → connection projection. */
  readonly taskRoutingRows: readonly TaskRoutingRow[];
  /** Recent text-generation spans, newest first. */
  readonly activitySpans: ReadonlyArray<TextTelemetrySpan>;
  /** Spans formatted for display. */
  readonly activityRows: readonly AiActivityRow[];
  /** Aggregate stats over the current buffer. */
  readonly activitySummary: TextTelemetrySummary;
  /** Per-task aggregates formatted for display. */
  readonly taskRows: readonly AiActivityTaskRow[];
  /** Whether any per-task rows exist. */
  readonly hasTaskRows: boolean;
  /** Whether any activity rows exist. */
  readonly hasActivityRows: boolean;
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

  get activityRows(): readonly AiActivityRow[] {
    return this._telemetry.spans.map((span) => ({
      id: span.id,
      taskLabel: span.task ?? 'text',
      modelLabel: span.model || span.provider,
      totalLabel: `${span.totalMs}ms`,
      ttftLabel: span.ttftMs === undefined ? '—' : `${span.ttftMs}ms ttft`,
      tokenLabel: `${span.promptTokens + span.completionTokens} tok`,
      showError: !span.ok,
    }));
  }

  get activitySummary(): TextTelemetrySummary {
    return this._telemetry.summary;
  }

  get taskRows(): readonly AiActivityTaskRow[] {
    return this._telemetry.summary.byTask.map((row) => ({
      task: row.task,
      count: row.count,
      medianTotalLabel: `${row.medianTotalMs}ms`,
      medianTtftLabel: row.medianTtftMs === undefined ? '—' : `${row.medianTtftMs}ms`,
      errorCount: row.errorCount,
    }));
  }

  get hasTaskRows(): boolean {
    return this._telemetry.summary.byTask.length > 0;
  }

  get hasActivityRows(): boolean {
    return this._telemetry.spans.length > 0;
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
