// apps/frontend/client/src/lib/services/audio/audio_cue_arbiter.test.ts
//
// C-523 AC-3 — one arbitration authority for map cues, combat state and the
// Music DJ. The DJ and map cues must never start competing tracks, and the
// deterministic priority is scripted > combat > map.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import { arbitrateAudioCue, createAudioCueArbiterState } from './audio_cue_arbiter.ts';

/**
 * A cue request literal. The arbiter's request shape is module-private, so the
 * tests build literals and let contextual typing from `arbitrateAudioCue`
 * check them — no exported test-only surface.
 */
const request = (overrides: {
  source?: 'map' | 'combat' | 'scripted';
  context?: string;
  url?: string | null;
  authored?: boolean;
} = {}) => ({
  source: 'map' as const,
  context: 'village',
  url: 'blob:village-theme' as string | null,
  authored: true,
  ...overrides,
});

describe('arbitrateAudioCue — first request', () => {
  test('admits the first request and records it as active', () => {
    const decision = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    expect(decision.play?.url).toBe('blob:village-theme');
    expect(decision.reason).toBe('admitted-first');
    expect(decision.state.active?.context).toBe('village');
    expect(decision.state.suspended).toBeUndefined();
  });

  test('does not mutate the input state', () => {
    const state = createAudioCueArbiterState();
    arbitrateAudioCue({ state, input: { kind: 'request', request: request() } });
    expect(state.active).toBeUndefined();
  });
});

describe('arbitrateAudioCue — priority', () => {
  test('combat preempts an authored map cue and suspends it', () => {
    const first = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    const second = arbitrateAudioCue({
      state: first.state,
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat', authored: false }),
      },
    });
    expect(second.reason).toBe('admitted-higher-priority');
    expect(second.play?.url).toBe('blob:combat');
    expect(second.state.suspended?.url).toBe('blob:village-theme');
  });

  test('a scripted cue preempts combat', () => {
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat', authored: false }),
      },
    });
    const scripted = arbitrateAudioCue({
      state: combat.state,
      input: {
        kind: 'request',
        request: request({ source: 'scripted', context: 'ending.fading_ward', url: 'blob:stinger' }),
      },
    });
    expect(scripted.reason).toBe('admitted-higher-priority');
    expect(scripted.play?.url).toBe('blob:stinger');
  });

  test('a map request never preempts combat', () => {
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat', authored: false }),
      },
    });
    const map = arbitrateAudioCue({
      state: combat.state,
      input: { kind: 'request', request: request({ url: 'blob:other-map' }) },
    });
    expect(map.reason).toBe('rejected-lower-priority');
    expect(map.play).toBeUndefined();
    expect(map.state.active?.url).toBe('blob:combat');
  });
});

describe('arbitrateAudioCue — DJ must not compete with an authored map cue', () => {
  const authored = arbitrateAudioCue({
    state: createAudioCueArbiterState(),
    input: { kind: 'request', request: request() },
  });

  test('rejects an unauthored DJ cue while an authored cue is active', () => {
    const dj = arbitrateAudioCue({
      state: authored.state,
      input: {
        kind: 'request',
        request: request({ context: 'dj:mood', url: 'blob:dj-pick', authored: false }),
      },
    });
    expect(dj.reason).toBe('rejected-authored-cue');
    expect(dj.play).toBeUndefined();
    expect(dj.state.active?.url).toBe('blob:village-theme');
  });

  test('admits a genuine authored map change', () => {
    const next = arbitrateAudioCue({
      state: authored.state,
      input: {
        kind: 'request',
        request: request({ context: 'inn', url: 'blob:inn-theme', authored: true }),
      },
    });
    expect(next.reason).toBe('admitted-context-change');
    expect(next.play?.url).toBe('blob:inn-theme');
  });

  test('an unauthored map cue may replace an unauthored one', () => {
    const unauthored = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ authored: false }) },
    });
    const next = arbitrateAudioCue({
      state: unauthored.state,
      input: {
        kind: 'request',
        request: request({ context: 'dj:mood', url: 'blob:dj-pick', authored: false }),
      },
    });
    expect(next.reason).toBe('admitted-unauthored');
    expect(next.play?.url).toBe('blob:dj-pick');
  });
});

describe('arbitrateAudioCue — no-op and release', () => {
  test('the same url is a no-op', () => {
    const first = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    const again = arbitrateAudioCue({
      state: first.state,
      input: { kind: 'request', request: request() },
    });
    expect(again.reason).toBe('no-change');
    expect(again.play).toBeUndefined();
  });

  test('releasing combat restores the suspended map cue', () => {
    const map = arbitrateAudioCue({ state: createAudioCueArbiterState(), input: { kind: 'request', request: request() } });
    const combat = arbitrateAudioCue({
      state: map.state,
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat', authored: false }),
      },
    });
    const released = arbitrateAudioCue({ state: combat.state, input: { kind: 'release', source: 'combat' } });
    expect(released.reason).toBe('released-restored');
    expect(released.play?.url).toBe('blob:village-theme');
    expect(released.state.active?.source).toBe('map');
    expect(released.state.suspended).toBeUndefined();
  });

  test('releasing a source that is not active is a no-op', () => {
    const map = arbitrateAudioCue({ state: createAudioCueArbiterState(), input: { kind: 'request', request: request() } });
    const released = arbitrateAudioCue({ state: map.state, input: { kind: 'release', source: 'combat' } });
    expect(released.reason).toBe('release-noop');
    expect(released.play).toBeUndefined();
    expect(released.state.active?.url).toBe('blob:village-theme');
  });

  test('releasing combat with nothing suspended leaves no active cue', () => {
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat', authored: false }),
      },
    });
    const released = arbitrateAudioCue({ state: combat.state, input: { kind: 'release', source: 'combat' } });
    expect(released.reason).toBe('released-empty');
    expect(released.play).toBeUndefined();
    expect(released.state.active).toBeUndefined();
  });
});

describe('arbitrateAudioCue — a cue miss never reaches the arbiter as random content', () => {
  test('a null url is rejected and changes nothing', () => {
    const first = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    const miss = arbitrateAudioCue({
      state: first.state,
      input: { kind: 'request', request: request({ url: null, context: 'ruined_shrine' }) },
    });
    expect(miss.reason).toBe('rejected-empty-url');
    expect(miss.play).toBeUndefined();
    expect(miss.state.active?.url).toBe('blob:village-theme');
  });
});
