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

  for (const raw of text.split(/(?<=[.!?;:])\s+|\n+/)) {
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
