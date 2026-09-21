// apps/frontend/client/src/lib/types/text_telemetry.ts
//
// Client-local telemetry shapes for the rolling LLM call buffer. These are
// UI-layer projections, not cross-boundary data, so they live in the app's
// local types.

import type { TextTask } from '@aikami/constants';

/** One recorded LLM call. */
export type TextTelemetrySpan = {
  /** Monotonic id, unique within a session. */
  id: number;
  /** Task type, when the call declared one. */
  task?: TextTask;
  /** Resolved provider registry id (e.g. 'openrouter', 'llamacpp'). */
  provider: string;
  /** Resolved model id. */
  model: string;
  /** Resolved adapter mode. */
  mode: string;
  /** Whether the call streamed tokens. */
  streamed: boolean;
  /** Time to first streamed token, when observed. */
  ttftMs?: number;
  /** Total wall-clock duration. */
  totalMs: number;
  /** Estimated prompt tokens (~4 chars/token). */
  promptTokens: number;
  /** Estimated completion tokens (~4 chars/token). */
  completionTokens: number;
  /** ISO timestamp of call start. */
  startedAt: string;
  /** Whether the call completed without error. */
  ok: boolean;
  /** Normalized error code when `ok` is false. */
  errorCode?: string;
};

/** Per-task aggregate, so call-2 (`envelope`) latency is measurable alone. */
export type TextTelemetryTaskSummary = {
  /** Task id, or 'untasked' when a call declared none. */
  task: TextTask | 'untasked';
  /** Number of spans for this task. */
  count: number;
  /** Median total duration in ms. */
  medianTotalMs: number;
  /** Median time-to-first-token in ms, when any span measured one. */
  medianTtftMs?: number;
  /** Count of failed spans for this task. */
  errorCount: number;
};

/** Aggregate stats for the activity view. */
export type TextTelemetrySummary = {
  /** Number of spans in the buffer. */
  count: number;
  /** Median total duration in ms. */
  medianTotalMs: number;
  /** Total estimated tokens across all spans. */
  totalTokens: number;
  /** Count of failed spans. */
  errorCount: number;
  /** Per-task breakdown, most frequent first. */
  byTask: readonly TextTelemetryTaskSummary[];
};
