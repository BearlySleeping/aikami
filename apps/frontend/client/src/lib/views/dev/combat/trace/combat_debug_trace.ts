// apps/frontend/client/src/lib/views/dev/combat/trace/combat_debug_trace.ts
//
// Bounded, ordered trace buffer for the combat debug workspace. Entries are
// ordered by (revision, sequence), never wall-clock time — timestamps are
// diagnostic metadata only. The buffer is bounded in entry count AND payload
// size, and reports dropped/truncated counts so a bounded trace can never
// silently masquerade as a complete replay export.
//
// Contract: combat debug workspace (execution prompt §7, §8)

/** Trace entry category — lets the timeline filter by actor/type/revision. */
export const COMBAT_DEBUG_TRACE_KINDS = [
  'request',
  'accepted',
  'rejected',
  'event',
  'state',
  'controller',
  'assertion',
] as const;

export type CombatDebugTraceKind = (typeof COMBAT_DEBUG_TRACE_KINDS)[number];

/** One immutable trace entry. Mutation happens by replacing the array. */
export type CombatDebugTraceEntry = {
  /** Monotonic sequence assigned by the buffer. */
  readonly sequence: number;
  readonly kind: CombatDebugTraceKind;
  /** State revision the entry belongs to. */
  readonly revision: number;
  /** Round/turn label at entry time, for grouping. */
  readonly turnLabel: string;
  /** Actor the entry concerns, when known. */
  readonly actorId: string | undefined;
  /** Command id when the entry maps to a command. */
  readonly commandId: string | undefined;
  /** Short human summary for the timeline row. */
  readonly summary: string;
  /** Bounded structured payload; truncated when oversized. */
  readonly payload: string | undefined;
  /** True when `payload` was truncated to fit the per-entry budget. */
  readonly payloadTruncated: boolean;
  /** Wall-clock diagnostic metadata only — never used for ordering. */
  readonly recordedAt: number;
};

/** Configuration for a buffer instance. */
export type CombatDebugTraceBufferOptions = {
  /** Maximum retained entries; oldest are dropped when exceeded. */
  readonly maxEntries?: number;
  /** Maximum characters retained per entry payload. */
  readonly maxPayloadChars?: number;
};

const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_PAYLOAD_CHARS = 4000;

/** Immutable snapshot of the buffer state for rendering. */
export type CombatDebugTraceSnapshot = {
  readonly entries: readonly CombatDebugTraceEntry[];
  readonly droppedCount: number;
  readonly nextSequence: number;
};

/** The append input — the buffer assigns sequence/truncation. */
export type CombatDebugTraceAppend = Omit<
  CombatDebugTraceEntry,
  'sequence' | 'recordedAt' | 'payloadTruncated'
>;

/**
 * A bounded ordered trace buffer. Not reactive itself — the owning ViewModel
 * copies {@link snapshot} into `$state` after each append. Keeping the buffer
 * plain makes it testable without rune polyfills.
 */
export class CombatDebugTraceBuffer {
  private readonly _maxEntries: number;
  private readonly _maxPayloadChars: number;
  private _entries: CombatDebugTraceEntry[] = [];
  private _droppedCount = 0;
  private _nextSequence = 0;

  constructor(options: CombatDebugTraceBufferOptions = {}) {
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._maxPayloadChars = options.maxPayloadChars ?? DEFAULT_MAX_PAYLOAD_CHARS;
  }

  /** Appends an entry, truncating an oversized payload and dropping the oldest. */
  append(entry: CombatDebugTraceAppend): CombatDebugTraceEntry {
    const { payload, payloadTruncated } = this._truncatePayload(entry.payload);
    const stored: CombatDebugTraceEntry = {
      ...entry,
      payload,
      payloadTruncated,
      sequence: this._nextSequence,
      recordedAt: Date.now(),
    };
    this._nextSequence += 1;

    const next = [...this._entries, stored];
    if (next.length > this._maxEntries) {
      const overflow = next.length - this._maxEntries;
      this._droppedCount += overflow;
      this._entries = next.slice(overflow);
    } else {
      this._entries = next;
    }
    return stored;
  }

  /** Current immutable snapshot. */
  snapshot(): CombatDebugTraceSnapshot {
    return {
      entries: this._entries,
      droppedCount: this._droppedCount,
      nextSequence: this._nextSequence,
    };
  }

  /** Clears all entries and resets counters. Used on reset/scenario switch. */
  clear(): void {
    this._entries = [];
    this._droppedCount = 0;
    this._nextSequence = 0;
  }

  /**
   * Filters entries without mutating the buffer. Presentation-only helper so
   * the timeline view stays logicless.
   */
  filter(options: {
    kind?: CombatDebugTraceKind;
    actorId?: string;
    minRevision?: number;
  }): CombatDebugTraceEntry[] {
    return this._entries.filter((entry) => {
      if (options.kind !== undefined && entry.kind !== options.kind) {
        return false;
      }
      if (options.actorId !== undefined && entry.actorId !== options.actorId) {
        return false;
      }
      if (options.minRevision !== undefined && entry.revision < options.minRevision) {
        return false;
      }
      return true;
    });
  }

  private _truncatePayload(payload: string | undefined): {
    payload: string | undefined;
    payloadTruncated: boolean;
  } {
    if (payload === undefined || payload.length <= this._maxPayloadChars) {
      return { payload, payloadTruncated: false };
    }
    return { payload: payload.slice(0, this._maxPayloadChars), payloadTruncated: true };
  }
}
