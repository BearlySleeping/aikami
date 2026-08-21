// .pi/extensions/lib/repetition.ts
//
// Detection of degenerate, repeating model output.
//
// 🔴 This catches INTRA-message degeneration, which is a different failure
// from an agent loop and is invisible to per-turn or per-tool-call guards.
// The case it was built from (2026-08-20): a single assistant message of
// 12,469 chars that repeated "Let me check the DNS." and close variants 113
// times. The agent loop was healthy the whole way — 308 turns, all making
// real tool calls — and one sampling run simply collapsed. Spend guards miss
// it too: at a 97% cache hit rate that session reached only ~$5.
//
// Trigger context, worth preserving: the model wanted to run `curl`, a policy
// hook rejected it without offering a working alternative, the fallbacks
// returned `code=000`, and it had no way forward. Repetition is the symptom
// of a dead end, so tripping this guard is a signal to look for one.

/** Segments shorter than this are too generic to signal collapse. */
export const MIN_SEGMENT_CHARS = 12;

/**
 * Highest number of times any single normalised segment repeats in `text`.
 *
 * Splits on sentence boundaries as well as newlines: the observed collapse
 * ran sentences together without separators ("…the records.Let me query the
 * DNS."), so newline splitting alone would have missed it. Comparison is
 * case- and whitespace-insensitive, which keeps the check independent of
 * the particular wording the model latched onto.
 */
export const maxRepeatedSegment = (text: string): { count: number; segment: string } => {
  const counts = new Map<string, number>();
  let best = { count: 0, segment: '' };

  for (const raw of text.split(/(?<=[.!?;:])(?:\s+|(?=[A-Z]))|\n+/)) {
    const segment = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (segment.length < MIN_SEGMENT_CHARS) {
      continue;
    }
    const count = (counts.get(segment) ?? 0) + 1;
    counts.set(segment, count);
    if (count > best.count) {
      best = { count, segment };
    }
  }

  return best;
};

// ─────────────────────────────────────────────────────────────────────────
// Cross-turn loops
//
// 🔴 A SECOND, distinct failure mode that `maxRepeatedSegment` cannot see.
// There the repetition is inside one message; here each message is fine on
// its own and the agent simply repeats the same turn forever:
//
//     thinking → bash(cmd) → result → thinking → bash(SAME cmd) → result → …
//
// Two real cases in this session store, both with EMPTY text content (the
// narration lived in `thinking` blocks, so a text-based check scores zero):
//
//   * 2026-08-21  88 identical `bash` calls in 98 turns.
//   * 2026-08-17  846 identical `bash` calls over 6h19m — a contract-pipeline
//                 implementer stage that burned the afternoon.
//
// Storm-breaker cannot catch these either: the commands SUCCEED every time
// (exit 0), and it only tracks consecutive failures.
//
// Threshold calibration, measured over all 270 stored sessions: 261 sessions
// never exceed a run of 2 identical turns, and the only two that go higher
// hit 88 and 846. The gap is enormous, so a threshold of 4 catches both known
// loops with zero false positives against real history.
// ─────────────────────────────────────────────────────────────────────────

/** Consecutive identical turns before a run is treated as a loop. */
export const DEFAULT_LOOP_THRESHOLD = 4;

/**
 * Identity of a turn for loop detection: its tool calls plus its text.
 *
 * Tool-call arguments dominate — an agent doing real work varies them. Text
 * is folded in so that two different reasoning paths landing on the same
 * command are not mistaken for a loop. Returns '' for turns with nothing
 * worth comparing, which resets the run rather than extending it.
 */
export const turnSignature = (options: {
  text: string;
  toolCalls: readonly { name: string; arguments: unknown }[];
}): string => {
  const text = options.text.trim().replace(/\s+/g, ' ').toLowerCase();
  const calls = options.toolCalls
    .map((call) => `${call.name}::${JSON.stringify(call.arguments ?? null)}`)
    .join('|');

  // A turn with no tool call and only trivial text carries no signal.
  if (calls.length === 0 && text.length < MIN_SEGMENT_CHARS) {
    return '';
  }
  return `${calls}##${text}`;
};

export type LoopTracker = {
  /** Record a signature; returns how many times it has now repeated in a row. */
  record: (signature: string) => number;
  reset: () => void;
};

/** Track consecutive identical turn signatures. */
export const createLoopTracker = (): LoopTracker => {
  let last = '';
  let run = 0;

  return {
    record: (signature) => {
      if (signature === '') {
        last = '';
        run = 0;
        return 0;
      }
      if (signature === last) {
        run += 1;
      } else {
        last = signature;
        run = 1;
      }
      return run;
    },
    reset: () => {
      last = '';
      run = 0;
    },
  };
};
