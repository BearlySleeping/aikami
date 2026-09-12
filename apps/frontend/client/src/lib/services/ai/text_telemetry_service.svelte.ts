// apps/frontend/client/src/lib/services/ai/text_telemetry_service.svelte.ts
//
// Rolling text-generation telemetry. One span per LLM call with the resolved
// routing, time-to-first-token, total duration, token estimates, and outcome.
// Replaces the ad-hoc `globalThis.__text_service_*` diagnostics with a typed,
// inspectable record that powers the AI Settings activity/cost view.
//
// Contract: C-507

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { TextTelemetrySpan, TextTelemetrySummary } from '$types';

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
      return { count: 0, medianTotalMs: 0, totalTokens: 0, errorCount: 0 };
    }
    const totals = spans.map((span) => span.totalMs).sort((a, b) => a - b);
    const mid = Math.floor(totals.length / 2);
    const medianTotalMs =
      totals.length % 2 === 0 ? Math.round((totals[mid - 1] + totals[mid]) / 2) : totals[mid];
    return {
      count: spans.length,
      medianTotalMs,
      totalTokens: spans.reduce((sum, span) => sum + span.promptTokens + span.completionTokens, 0),
      errorCount: spans.filter((span) => !span.ok).length,
    };
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
