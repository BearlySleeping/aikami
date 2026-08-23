import { describe, expect, test } from 'bun:test';
import {
  createCycleTracker,
  createLoopTracker,
  DEFAULT_CYCLE_THRESHOLD,
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

/**
 * Cross-turn cycles — the failure that got past both guards above.
 *
 * Observed 2026-08-23: the period-1 guard steered at 4 repeats of one `read`,
 * and the model responded by alternating TWO calls instead of repeating one.
 * It ran that pair for 26 cycles (84 assistant turns, ~12 minutes) with
 * byte-identical arguments and byte-identical reasoning before the user
 * interrupted it. `createLoopTracker`'s run never exceeded 1 the whole time.
 */
describe('createCycleTracker', () => {
  const call = (name: string, arg: string) =>
    turnSignature({ text: '', toolCalls: [{ name, arguments: { arg } }] });

  test('does not fire on varied work', () => {
    const tracker = createCycleTracker();
    for (let i = 0; i < 40; i++) {
      expect(tracker.record(call('bash', `step-${i}`))).toBeNull();
    }
  });

  test('does not fire on a cycle that has not completed enough times', () => {
    const tracker = createCycleTracker();
    // Two completed cycles is under the default threshold of three: healthy
    // sessions reach a period-2 match run of 2, so this must stay quiet.
    const seen = [
      tracker.record(call('bash', 'a')),
      tracker.record(call('read', 'b')),
      tracker.record(call('bash', 'a')),
      tracker.record(call('read', 'b')),
      tracker.record(call('bash', 'a')),
      tracker.record(call('read', 'b')),
    ];
    expect(seen.every((hit) => hit === null)).toBe(true);
  });

  test('detects the observed A-B-A-B alternation', () => {
    const tracker = createCycleTracker();
    let hit: ReturnType<typeof tracker.record> = null;
    for (let i = 0; i < 12; i++) {
      hit = tracker.record(i % 2 === 0 ? call('bash', 'a') : call('read', 'b'));
      if (hit) {
        break;
      }
    }
    expect(hit).not.toBeNull();
    expect(hit?.period).toBe(2);
    expect(hit?.cycles).toBeGreaterThanOrEqual(DEFAULT_CYCLE_THRESHOLD);
  });

  test('reports the shortest qualifying period', () => {
    // An A B A B run also satisfies period 4; period 2 is what the agent is
    // actually doing, and is what the steering message has to describe.
    const tracker = createCycleTracker();
    let hit: ReturnType<typeof tracker.record> = null;
    for (let i = 0; i < 20 && !hit; i++) {
      hit = tracker.record(i % 2 === 0 ? call('bash', 'a') : call('read', 'b'));
    }
    expect(hit?.period).toBe(2);
  });

  test('detects a three-step cycle', () => {
    const tracker = createCycleTracker();
    const steps = [call('bash', 'a'), call('read', 'b'), call('grep', 'c')];
    let hit: ReturnType<typeof tracker.record> = null;
    for (let i = 0; i < 20 && !hit; i++) {
      hit = tracker.record(steps[i % 3] ?? '');
    }
    expect(hit?.period).toBe(3);
  });

  test('a signal-free turn breaks the cycle rather than extending it', () => {
    const tracker = createCycleTracker();
    for (let i = 0; i < 5; i++) {
      tracker.record(i % 2 === 0 ? call('bash', 'a') : call('read', 'b'));
    }
    tracker.record('');
    // History is cleared, so the cycle has to build again from scratch.
    expect(tracker.record(call('bash', 'a'))).toBeNull();
    expect(tracker.record(call('read', 'b'))).toBeNull();
    expect(tracker.record(call('bash', 'a'))).toBeNull();
  });

  test('reset clears accumulated history', () => {
    const tracker = createCycleTracker();
    for (let i = 0; i < 10; i++) {
      tracker.record(i % 2 === 0 ? call('bash', 'a') : call('read', 'b'));
    }
    tracker.reset();
    expect(tracker.record(call('bash', 'a'))).toBeNull();
  });
});

/**
 * A thinking-only turn must still have an identity.
 *
 * On DeepSeek a turn that makes no tool call has an EMPTY `text` array and
 * carries all its narration in `thinking` blocks. Hashing that to '' does not
 * merely fail to match — it resets the run and erases the loop evidence.
 */
describe('turnSignature thinking fallback', () => {
  test('uses thinking as identity when a turn makes no tool call', () => {
    const signature = turnSignature({
      text: '',
      toolCalls: [],
      thinking: 'Actually, let me reconsider the whole thing from a different angle.',
    });
    expect(signature).not.toBe('');
  });

  test('two identical thinking-only turns share a signature', () => {
    const options = {
      text: '',
      toolCalls: [],
      thinking: 'Actually, let me reconsider the whole thing.',
    };
    expect(turnSignature(options)).toBe(turnSignature({ ...options }));
  });

  test('ignores thinking when the turn makes a tool call', () => {
    // Identical arguments are the loop signal. Folding in prose that varies
    // run-to-run would mask a real loop, so the two must stay equal here.
    const withThinking = turnSignature({
      text: '',
      toolCalls: [{ name: 'bash', arguments: { command: 'ls' } }],
      thinking: 'One line of reasoning that differs every time.',
    });
    const withoutThinking = turnSignature({
      text: '',
      toolCalls: [{ name: 'bash', arguments: { command: 'ls' } }],
      thinking: 'A completely different line of reasoning.',
    });
    expect(withThinking).toBe(withoutThinking);
  });

  test('still returns empty for a turn with neither calls nor narration', () => {
    expect(turnSignature({ text: '', toolCalls: [], thinking: 'ok.' })).toBe('');
  });
});
