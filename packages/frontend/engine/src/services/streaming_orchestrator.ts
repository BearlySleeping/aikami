// packages/frontend/engine/src/services/streaming_orchestrator.ts

import { type DeepPartial, parse as jsonchunkParse } from 'jsonchunk';
import { BaseEngineClass, type BaseEngineClassOptions } from '../base_engine_class.ts';
import { Position } from '../components/position.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Incoming streaming JSON payload for AI tool invocations that mutate
 * entity state in the bitECS core.
 *
 * Each payload targets a specific entity and carries positional updates
 * and/or state mask changes. Partial payloads are supported — jsonchunk
 * resolves whatever fields are present in the fragment.
 */
export type ActionMutationPayload = {
  /** Target entity ID in the bitECS world. */
  entityId: number;
  /** World-space X coordinate delta or absolute position. */
  targetX: number;
  /** World-space Y coordinate delta or absolute position. */
  targetY: number;
  /** Bitmask change to apply to the entity's state word. */
  stateMaskChange: number;
};

/**
 * Mutation result returned after processing a complete payload.
 */
export type MutationResult = {
  /** The parsed mutation payload. */
  payload: ActionMutationPayload;
  /** Whether the entity ID was valid (existed in Position arrays). */
  entityExisted: boolean;
};

/**
 * Options for constructing a {@link StreamingOrchestratorService}.
 */
export type StreamingOrchestratorOptions = BaseEngineClassOptions & {
  /** Callback invoked for each successfully parsed mutation. */
  onMutation?: (result: MutationResult) => void;
};

// ---------------------------------------------------------------------------
// StreamingOrchestratorService
// ---------------------------------------------------------------------------

/**
 * Browser-side network ingestion framework for parsing and injecting
 * streaming AI tool invocations directly into the bitECS core game memory.
 *
 * Architecture:
 * 1. Interfaces directly with `response.body.getReader()` using native fetch streams.
 * 2. Accumulates newline-delimited text chunks in a string buffer.
 * 3. Uses the zero-dependency `jsonchunk` micro-parser for partial JSON recovery —
 *    NEVER calls `JSON.parse()` inside the streaming reader (syntax traps).
 * 4. Writes parsed numeric updates directly to raw component arrays by entity ID
 *    index (e.g., `Position.x[eid] = parsed.targetX`), keeping execution
 *    targets monomorphic.
 * 5. Emits mutation results via callback for the ViewModel layer to project
 *    to the UI via `requestAnimationFrame` and `$state.raw`.
 *
 * Instantiate via {@link StreamingOrchestratorService.create}, never with `new`.
 */
export class StreamingOrchestratorService extends BaseEngineClass<StreamingOrchestratorOptions> {
  /** Accumulated stream text for newline-boundary reassembly. */
  private _accumulator = '';

  /** Optional callback for each successfully parsed mutation. */
  private readonly _onMutation?: (result: MutationResult) => void;

  /**
   * Do NOT use `new StreamingOrchestratorService()`. Use
   * {@link StreamingOrchestratorService.create} instead.
   */
  constructor(options: StreamingOrchestratorOptions) {
    super(options);
    this._onMutation = options.onMutation;
  }

  // -----------------------------------------------------------------------
  // Public: chunk processing
  // -----------------------------------------------------------------------

  /**
   * Processes a raw binary chunk from a Web Streams reader.
   *
   * Decodes the chunk as UTF-8 text with streaming mode, accumulates into
   * the internal buffer, splits on newline boundaries, and attempts partial
   * JSON parsing via `jsonchunk` for each complete line.
   *
   * The final incomplete line is retained in the accumulator for the next
   * chunk — no data is dropped at newline boundaries.
   *
   * @param binaryChunk - Raw Uint8Array from `reader.read()`.
   * @returns Array of successfully parsed mutation results.
   */
  processChunk(binaryChunk: Uint8Array): MutationResult[] {
    const decoder = new TextDecoder('utf-8');
    this._accumulator += decoder.decode(binaryChunk, { stream: true });

    const results: MutationResult[] = [];
    const lines = this._accumulator.split('\n');

    // Keep the last (potentially incomplete) line in the accumulator
    this._accumulator = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      // Use jsonchunk for partial parsing — never JSON.parse() here.
      // A single broken bracket or incomplete token in a streaming context
      // would crash JSON.parse() and drop the entire pipeline.
      const parsed = jsonchunkParse<ActionMutationPayload>(trimmed);
      if (!parsed) {
        continue;
      }

      const result = this._applyMutation(parsed);
      results.push(result);
      this._onMutation?.(result);
    }

    return results;
  }

  /**
   * Yields parsed {@link ActionMutationPayload} objects from a streaming
   * fetch {@link Response}.
   *
   * Reads chunks from `response.body.getReader()`, processes them through
   * {@link processChunk}, and yields each successfully parsed payload.
   *
   * Callers should iterate with `for await...of` to receive mutations
   * as they arrive from the network.
   *
   * @param response - A fetch Response with a readable body (streaming endpoint).
   * @throws If the response has no body.
   */
  async *streamFromResponse(response: Response): AsyncGenerator<MutationResult> {
    if (!response.body) {
      throw new Error('StreamingOrchestratorService: response has no body');
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        const results = this.processChunk(value);
        for (const result of results) {
          yield result;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Resets the internal accumulator buffer.
   *
   * Call this when starting a new stream to prevent stale data from a
   * previous stream from corrupting the new one.
   */
  reset(): void {
    this._accumulator = '';
  }

  /**
   * Returns the current accumulator content for debugging partial-parsing
   * state. Only the last incomplete line is retained between chunks.
   */
  get accumulatorSnapshot(): string {
    return this._accumulator;
  }

  // -----------------------------------------------------------------------
  // Private: mutation application
  // -----------------------------------------------------------------------

  /**
   * Applies a parsed {@link ActionMutationPayload} directly to bitECS
   * component arrays with no proxy interception.
   *
   * Accepts a DeepPartial since jsonchunk may only resolve a subset of
   * fields from incomplete stream chunks. Uses `typeof` checks on every
   * field before writing.
   *
   * Writes are direct index assignments (`Position.x[eid] = value`) which
   * V8 can keep monomorphic — no property access chains, no Proxy traps,
   * no intermediate object allocations.
   *
   * @param payload - The parsed (possibly partial) mutation to apply.
   * @returns Result indicating whether the entity existed.
   */
  private _applyMutation(payload: DeepPartial<ActionMutationPayload>): MutationResult {
    const { entityId, targetX, targetY } = payload;

    // Guard: entityId is required to index into component arrays
    if (typeof entityId !== 'number') {
      return { payload: payload as ActionMutationPayload, entityExisted: false };
    }

    const entityExisted =
      typeof Position.x[entityId] === 'number' && typeof Position.y[entityId] === 'number';

    // Direct index mutations — monomorphic, no proxy traps
    if (typeof targetX === 'number') {
      Position.x[entityId] = targetX;
    }
    if (typeof targetY === 'number') {
      Position.y[entityId] = targetY;
    }

    return { payload: payload as ActionMutationPayload, entityExisted };
  }
}
