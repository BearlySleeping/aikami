import { describe, expect, test } from 'bun:test';
import {
  createLoopTracker,
  DEFAULT_LOOP_THRESHOLD,
  maxRepeatedSegment,
  turnSignature,
} from './repetition.ts';

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

  test('splits concatenated sentences with no whitespace between them', () => {
    // The observed collapse also ran sentences together with NO separator at
    // all ("…the records.Let me query the DNS."), so the boundary split must
    // fire on punctuation directly followed by an uppercase letter too.
    const text =
      'Let me check the DNS records.Let me check the DNS records.Let me check the DNS records.';
    const result = maxRepeatedSegment(text);
    expect(result.count).toBe(3);
    expect(result.segment).toBe('let me check the dns records.');
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

describe('turnSignature', () => {
  test('is empty for a turn with no tool call and only trivial text', () => {
    expect(turnSignature({ text: 'ok', toolCalls: [] })).toBe('');
    expect(turnSignature({ text: '', toolCalls: [] })).toBe('');
  });

  test('is stable for identical tool calls even when text is empty', () => {
    // The observed loops had EMPTY text — narration lived in thinking blocks.
    const call = [{ name: 'bash', arguments: { command: 'head -60 chunk.js' } }];
    expect(turnSignature({ text: '', toolCalls: call })).toBe(
      turnSignature({ text: '', toolCalls: call }),
    );
    expect(turnSignature({ text: '', toolCalls: call })).not.toBe('');
  });

  test('differs when tool arguments differ', () => {
    const a = turnSignature({
      text: '',
      toolCalls: [{ name: 'bash', arguments: { command: 'ls' } }],
    });
    const b = turnSignature({
      text: '',
      toolCalls: [{ name: 'bash', arguments: { command: 'pwd' } }],
    });
    expect(a).not.toBe(b);
  });

  test('differs when the narration differs for the same command', () => {
    const call = [{ name: 'bash', arguments: { command: 'ls' } }];
    expect(turnSignature({ text: 'Checking the build output.', toolCalls: call })).not.toBe(
      turnSignature({ text: 'Now verifying the deploy.', toolCalls: call }),
    );
  });
});

describe('createLoopTracker', () => {
  const call = (command: string) => [{ name: 'bash', arguments: { command } }];

  test('counts consecutive identical turns', () => {
    const tracker = createLoopTracker();
    const sig = turnSignature({ text: '', toolCalls: call('head -60 chunk.js') });
    expect(tracker.record(sig)).toBe(1);
    expect(tracker.record(sig)).toBe(2);
    expect(tracker.record(sig)).toBe(3);
  });

  test('resets the run when the turn changes', () => {
    const tracker = createLoopTracker();
    const a = turnSignature({ text: '', toolCalls: call('ls') });
    const b = turnSignature({ text: '', toolCalls: call('pwd') });
    expect(tracker.record(a)).toBe(1);
    expect(tracker.record(a)).toBe(2);
    expect(tracker.record(b)).toBe(1);
  });

  test('an empty signature breaks the run rather than extending it', () => {
    const tracker = createLoopTracker();
    const sig = turnSignature({ text: '', toolCalls: call('ls') });
    tracker.record(sig);
    tracker.record(sig);
    expect(tracker.record('')).toBe(0);
    expect(tracker.record(sig)).toBe(1);
  });

  test('reaches the default threshold on the observed loop shape', () => {
    // 2026-08-21: 88 identical bash calls. 2026-08-17: 846 over 6h19m.
    const tracker = createLoopTracker();
    const sig = turnSignature({ text: '', toolCalls: call('head -60 index-server.js') });
    let run = 0;
    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD; i++) {
      run = tracker.record(sig);
    }
    expect(run).toBe(DEFAULT_LOOP_THRESHOLD);
  });

  test('healthy alternating work never reaches the threshold', () => {
    // Measured: 261 of 270 real sessions never exceed a run of 2.
    const tracker = createLoopTracker();
    let max = 0;
    for (const cmd of ['ls', 'pwd', 'ls', 'cat a', 'cat b', 'ls', 'pwd']) {
      max = Math.max(max, tracker.record(turnSignature({ text: '', toolCalls: call(cmd) })));
    }
    expect(max).toBeLessThan(DEFAULT_LOOP_THRESHOLD);
  });
});
