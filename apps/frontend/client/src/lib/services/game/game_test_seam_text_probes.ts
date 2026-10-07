// apps/frontend/client/src/lib/services/game/game_test_seam_text_probes.ts
//
// Issue #382 text-AI probes for the non-production test seam.
//
// Split out of `game_test_seam.ts`: that module already carries the game,
// management and evidence probes, and adding the #382 telemetry probes pushed it
// past the source-file-size hard limit. The split is along a real seam —
// everything here observes TEXT GENERATION, and everything left behind drives
// the game world.
//
// These probes are measurement apparatus, not product code. Each one calls the
// production service; none replaces, stubs or short-circuits a production path.
// They are reachable only through `window.__AIKAMI_TEST__`, which the seam
// installs outside production mode.

import type { TextTask } from '@aikami/constants';
import type { TextTelemetrySpan, TextTelemetrySummary } from '@aikami/types';
import { textGenerationService } from '../ai/text_generation_service.svelte.ts';
import { textTelemetryService } from '../ai/text_telemetry_service.svelte.ts';

/**
 * Reads the rolling text-telemetry buffer, so an E2E can assert the CRITICAL
 * PATH of a real turn — routing, deadline outcome, token provenance — rather
 * than inferring it from what rendered.
 *
 * Content-free by construction: the buffer holds metadata only, so returning it
 * cannot leak a prompt or a reply into a test report.
 */
export const readTextTelemetry = (): {
  spans: ReadonlyArray<TextTelemetrySpan>;
  summary: TextTelemetrySummary;
} => ({ spans: textTelemetryService.spans, summary: textTelemetryService.summary });

/** The last routing the gateway resolved for a text call, or empty if none. */
export const readResolvedTextRouting = (): {
  provider: string;
  model: string;
  endpoint: string;
} => {
  const routing = (globalThis as Record<string, unknown>).__text_service_resolved_routing;
  if (typeof routing !== 'object' || routing === null) {
    return { provider: '', model: '', endpoint: '' };
  }
  const record = routing as Record<string, unknown>;
  return {
    provider: typeof record.provider === 'string' ? record.provider : '',
    model: typeof record.model === 'string' ? record.model : '',
    endpoint: typeof record.endpoint === 'string' ? record.endpoint : '',
  };
};

/** Options for one benchmark batch. */
export type StructuredBatchBenchmarkOptions = {
  /** How many identical calls to issue at once. */
  readonly count: number;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly schemaName: string;
  /**
   * Omit to exercise the production ROLE routing, which is what the game does.
   * The #382 baseline deliberately omits it: a benchmark that pinned a model
   * would not measure the routing path a player actually hits.
   */
  readonly model?: string;
  readonly task?: TextTask;
};

/** What the client observed while running a batch. */
export type StructuredBatchBenchmarkReport = {
  readonly requestedCalls: number;
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly wallClockMs: number;
  readonly sampleResult: { readonly spansRecorded: number; readonly coalescedSpans: number };
};

/**
 * Issues N `extractStructure` calls IDENTICAL in every input the request
 * identity derives from, and reports what the client observed.
 *
 * The #382 baseline harness compares how many HTTP requests reach the provider
 * for one logical batch of identical work. It deliberately does NOT report that
 * count itself: the only trustworthy count is what went on the wire, which the
 * harness observes from outside. This returns the client-side view so the two
 * can be cross-checked — if the client claims one attempt while the wire shows
 * N, something is wrong that neither number shows alone.
 *
 * That cross-check has already earned its place twice over. The first version
 * read the buffer with `slice(before)`, but it is NEWEST-FEST
 * (`[entry, ...spans]`), so that sliced the wrong end and reported zero
 * coalesced spans on a run that coalesced all five. The second attempt fixed
 * the direction but still used a LENGTH delta, which reads as zero once the
 * 100-entry cap is reached and the length stops moving. Both times the WIRE
 * count was right, which is precisely why the harness does not trust the
 * client's own accounting.
 *
 * Every call runs the PRODUCTION `extractStructure`, so local-first routing, the
 * shared deadline and in-flight coalescing all apply as they do in the game.
 */
export const runStructuredBatchBenchmark = async (
  options: StructuredBatchBenchmarkOptions,
): Promise<StructuredBatchBenchmarkReport> => {
  // Boundary by span ID, not by buffer length.
  //
  // `TextTelemetryService` prepends and caps the buffer at 100 entries, so once
  // it is full its LENGTH NEVER CHANGES and a length delta silently reads as
  // zero new spans. `id` is a monotonic counter assigned at record time, so the
  // highest id seen before the batch is a boundary that stays correct whether
  // the buffer is empty, partly full or saturated.
  const highestIdBefore = textTelemetryService.spans.reduce(
    (highest, span) => Math.max(highest, span.id),
    0,
  );
  const startedAt = performance.now();
  const schema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      mood: { type: 'string' },
    },
    required: ['summary', 'mood'],
    additionalProperties: false,
  } as const;

  const outcomes = await Promise.allSettled(
    Array.from({ length: options.count }, () =>
      textGenerationService.extractStructure({
        schema,
        schemaName: options.schemaName,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.task === undefined ? {} : { task: options.task }),
      }),
    ),
  );
  const wallClockMs = performance.now() - startedAt;
  const newSpans = textTelemetryService.spans.filter((span) => span.id > highestIdBefore);
  return {
    requestedCalls: outcomes.length,
    succeededCalls: outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    failedCalls: outcomes.filter((outcome) => outcome.status === 'rejected').length,
    wallClockMs,
    // What the CLIENT thinks it did, for cross-checking the wire count.
    sampleResult: {
      spansRecorded: newSpans.length,
      coalescedSpans: newSpans.filter((span) => span.cacheLayer === 'in-flight-dedup').length,
    },
  };
};
