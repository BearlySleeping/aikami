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
 *
 * 🔴 `:` is deliberately NOT a boundary, unlike `.!?;`. A colon introduces
 * what follows rather than closing a statement, so splitting on it turned
 * every markdown list LABEL into its own segment. Observed false positive
 * (2026-08-24): a legitimate end-of-task summary listing ten distinct edits
 * to one file as "- **`release.yml`**: <different change each time>" scored
 * 10 repeats of the label and tripped the guard, even though every actual
 * claim in the message was unique. Splitting on `:` also cannot help the
 * collapse case — a model stuck on one phrase repeats the whole phrase, so
 * the newline and sentence boundaries already catch it.
 */
export const maxRepeatedSegment = (text: string): { count: number; segment: string } => {
  const counts = new Map<string, number>();
  let best = { count: 0, segment: '' };

  for (const raw of text.split(/(?<=[.!?;])(?:\s+|(?=[A-Z]))|\n+/)) {
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
  /**
   * Reasoning-block narration, used ONLY as identity for a turn that makes no
   * tool call. On DeepSeek every turn's narration lives in `thinking` blocks
   * and `text` is empty, so without this a thinking-only turn hashes to '' —
   * which does not merely fail to match, it RESETS the run and erases the
   * loop evidence gathered so far. It is deliberately excluded when tool
   * calls are present: identical arguments are the real loop signal, and
   * folding in prose that varies run-to-run would mask that.
   */
  thinking?: string;
}): string => {
  const text = options.text.trim().replace(/\s+/g, ' ').toLowerCase();
  const calls = options.toolCalls
    .map((call) => `${call.name}::${JSON.stringify(call.arguments ?? null)}`)
    .join('|');

  if (calls.length === 0 && text.length < MIN_SEGMENT_CHARS) {
    const thinking = (options.thinking ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    // A turn with neither a tool call nor any narration carries no signal.
    return thinking.length < MIN_SEGMENT_CHARS ? '' : `##${thinking}`;
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

// ─────────────────────────────────────────────────────────────────────────
// Multi-step cycles
//
// 🔴 A THIRD failure mode, and the one that got past everything above.
// `createLoopTracker` counts CONSECUTIVE identical turns, so it only sees a
// period-1 loop (A A A A). It is blind to a cycle:
//
//     bash(X) → read(Y) → bash(X) → read(Y) → …
//
// Observed 2026-08-23: after the period-1 guard steered at 4 repeats of one
// `read`, the model obeyed the letter of the steer — "do something materially
// different" — by alternating TWO actions instead of repeating one. It then
// ran that pair for 26 cycles (turns 84→146, ~12 minutes) with byte-identical
// tool arguments AND byte-identical reasoning each time, until the human
// interrupted it. The period-1 tracker's run never exceeded 1 the whole way.
//
// Threshold calibration, measured over all 285 stored sessions with ≥10
// assistant turns: healthy sessions reach a period-2 match run of at most 2
// (p50=0, p99=1), while the wedged ones reach 52, 86 and 844. As with the
// period-1 threshold the gap is enormous, so requiring 3 completed cycles
// catches every observed case with no false positive against real history.
// ─────────────────────────────────────────────────────────────────────────

/** Longest cycle length considered. Period 1 is the loop tracker's job. */
export const DEFAULT_MAX_CYCLE_PERIOD = 4;

/** Completed cycle repeats before a cycle is treated as a loop. */
export const DEFAULT_CYCLE_THRESHOLD = 3;

/** How much signature history to retain — enough for the widest cycle check. */
const historyLimit = (maxPeriod: number, threshold: number): number =>
  maxPeriod * (threshold + 1) * 2;

export type CycleHit = {
  /** Length of the repeating cycle, ≥2. */
  period: number;
  /** How many times the cycle has completed back-to-back. */
  cycles: number;
};

export type CycleTracker = {
  /**
   * Record a signature; returns the cycle it completes, or null.
   *
   * The SHORTEST qualifying period wins: an A B A B run also satisfies
   * period 4, and reporting 2 describes what the agent is actually doing.
   */
  record: (signature: string) => CycleHit | null;
  reset: () => void;
};

/** Track repeating multi-step cycles (period 2..maxPeriod) in turn signatures. */
export const createCycleTracker = (options?: {
  maxPeriod?: number;
  threshold?: number;
}): CycleTracker => {
  const maxPeriod = options?.maxPeriod ?? DEFAULT_MAX_CYCLE_PERIOD;
  const threshold = options?.threshold ?? DEFAULT_CYCLE_THRESHOLD;
  const limit = historyLimit(maxPeriod, threshold);
  let history: string[] = [];

  return {
    record: (signature) => {
      // A signal-free turn breaks any cycle rather than extending it, for the
      // same reason the loop tracker resets on one.
      if (signature === '') {
        history = [];
        return null;
      }

      history.push(signature);
      if (history.length > limit) {
        history = history.slice(-limit);
      }

      for (let period = 2; period <= maxPeriod; period++) {
        // Count how far back the sequence keeps matching itself `period` ago.
        let matches = 0;
        for (let i = history.length - 1; i - period >= 0; i--) {
          if (history[i] !== history[i - period]) {
            break;
          }
          matches++;
        }
        const cycles = Math.floor(matches / period);
        if (cycles >= threshold) {
          return { period, cycles };
        }
      }

      return null;
    },
    reset: () => {
      history = [];
    },
  };
};
