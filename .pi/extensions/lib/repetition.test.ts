import { describe, expect, test } from 'bun:test';
import { maxRepeatedSegment } from './repetition.ts';

/**
 * The guard exists to catch the failure observed on 2026-08-20: a single
 * assistant message of 12,469 chars that repeated "Let me check the DNS."
 * and friends 113 times before the run was killed by hand. The agent loop
 * was healthy throughout — one sampling run degenerated — so the detector
 * has to work on the text of ONE message.
 */
describe('maxRepeatedSegment', () => {
  test('returns a zero count for text with no qualifying segments', () => {
    expect(maxRepeatedSegment('')).toEqual({ count: 0, segment: '' });
    expect(maxRepeatedSegment('ok. fine. yes.')).toEqual({ count: 0, segment: '' });
  });

  test('counts a segment once when it appears once', () => {
    const result = maxRepeatedSegment('I will start by reading the deploy script.');
    expect(result.count).toBe(1);
  });

  test('ignores short segments that are generic by nature', () => {
    // Each fragment is under MIN_SEGMENT_CHARS, so none should be counted
    // even though they repeat — short filler is not evidence of collapse.
    expect(maxRepeatedSegment('Done. Done. Done. Done. Done. Done.').count).toBe(0);
  });

  test('normalises whitespace and case before comparing', () => {
    const text =
      'Let me check the records.\nLET ME   CHECK the records.\nlet me check the records.';
    const result = maxRepeatedSegment(text);
    expect(result.count).toBe(3);
    expect(result.segment).toBe('let me check the records.');
  });

  test('splits on sentence boundaries as well as newlines', () => {
    // The real collapse ran sentences together without newlines
    // ("…the records.Let me query the DNS."), so boundary splitting matters.
    const text =
      'Let me check the DNS state. Let me check the DNS state. Let me check the DNS state.';
    expect(maxRepeatedSegment(text).count).toBe(3);
  });

  test('detects the observed repetition collapse above the default threshold', () => {
    const collapsed = [
      'The staging client returns 404 for the root path.',
      ...Array.from({ length: 40 }, () => 'Let me check the DNS records via the cf CLI.'),
    ].join('\n');

    const result = maxRepeatedSegment(collapsed);
    expect(result.count).toBe(40);
    expect(result.segment).toBe('let me check the dns records via the cf cli.');
    expect(result.count).toBeGreaterThanOrEqual(6); // PI_REPETITION_THRESHOLD default
  });

  test('does not trip on healthy prose that reuses a phrase a few times', () => {
    // Verified against all 1318 non-collapsed assistant messages in the
    // 2026-08-20 session: the highest repeat count observed was 1.
    const healthy = [
      "I'll start by understanding the current state.",
      'The deploy script reads wrangler.jsonc and uploads the client bundle.',
      'The staging worker resolves, but the custom domain does not.',
      'Next I will compare the two wrangler configs.',
    ].join('\n');

    expect(maxRepeatedSegment(healthy).count).toBeLessThan(6);
  });
});
