// apps/frontend/client/src/lib/services/ai/text_telemetry_service.svelte.ts
//
// Rolling text-generation telemetry. One span per LLM call with the resolved
// routing, time-to-first-token, total duration, token estimates, and outcome.
// Replaces the ad-hoc `globalThis.__text_service_*` diagnostics with a typed,
// inspectable record that powers the AI Settings activity/cost view.
//
// Contract: C-507

import type { TextTask } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { TextTelemetrySpan, TextTelemetrySummary, TextTelemetryTaskSummary } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextTelemetryServiceOptions = BaseFrontendClassOptions;

/** Public surface of the telemetry singleton. */
export type TextTelemetryServiceInterface = BaseFrontendClassInterface & {
  /** Most recent spans, newest first (reactive). */
  readonly spans: ReadonlyArray<TextTelemetrySpan>;
  /** Aggregate stats over the current buffer. */
  readonly summary: TextTelemetrySummary;
  /** Records a completed call. `startedAt` defaults to now when omitted. */
  record(span: Omit<TextTelemetrySpan, 'id' | 'startedAt'> & { startedAt?: string }): void;
  /** Clears the buffer. */
  clear(): void;
};

/** Ring-buffer capacity. */
const MAX_SPANS = 100;

/** Median of a numeric list (0 for an empty list). */
const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TextTelemetryService
  extends BaseFrontendClass<TextTelemetryServiceOptions>
  implements TextTelemetryServiceInterface
{
  private _spans = $state<TextTelemetrySpan[]>([]);
  private _nextId = 1;

  get spans(): ReadonlyArray<TextTelemetrySpan> {
    return this._spans;
  }

  get summary(): TextTelemetrySummary {
    const spans = this._spans;
    if (spans.length === 0) {
      return { count: 0, medianTotalMs: 0, totalTokens: 0, errorCount: 0, byTask: [] };
    }
    return {
      count: spans.length,
      medianTotalMs: median(spans.map((span) => span.totalMs)),
      totalTokens: spans.reduce((sum, span) => sum + span.promptTokens + span.completionTokens, 0),
      errorCount: spans.filter((span) => !span.ok).length,
      byTask: this._summarizeByTask(spans),
    };
  }

  /** Groups spans by task and computes per-task medians, most frequent first. */
  private _summarizeByTask(spans: ReadonlyArray<TextTelemetrySpan>): TextTelemetryTaskSummary[] {
    const buckets = new Map<TextTask | 'untasked', TextTelemetrySpan[]>();
    for (const span of spans) {
      const key = span.task ?? 'untasked';
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(span);
      } else {
        buckets.set(key, [span]);
      }
    }

    return [...buckets.entries()]
      .map(([task, bucket]): TextTelemetryTaskSummary => {
        const ttfts = bucket
          .map((span) => span.ttftMs)
          .filter((value): value is number => value !== undefined);
        const medianTtftMs = ttfts.length > 0 ? median(ttfts) : undefined;
        return {
          task,
          count: bucket.length,
          medianTotalMs: median(bucket.map((span) => span.totalMs)),
          medianTtftMs,
          errorCount: bucket.filter((span) => !span.ok).length,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  record(span: Omit<TextTelemetrySpan, 'id' | 'startedAt'> & { startedAt?: string }): void {
    const entry: TextTelemetrySpan = {
      ...span,
      id: this._nextId++,
      startedAt: span.startedAt ?? new Date().toISOString(),
    };
    this._spans = [entry, ...this._spans].slice(0, MAX_SPANS);
  }

  clear(): void {
    this._spans = [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const textTelemetryService: TextTelemetryServiceInterface = TextTelemetryService.create({
  className: 'TextTelemetryService',
});
