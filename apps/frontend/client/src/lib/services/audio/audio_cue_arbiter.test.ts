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
const request = (
  overrides: {
    source?: 'map' | 'combat' | 'scripted';
    context?: string;
    url?: string | null;
    authored?: boolean;
  } = {},
) => ({
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
    expect(decision.state.suspended).toEqual([]);
  });

  test('does not mutate the input state', () => {
    const state = createAudioCueArbiterState();
    arbitrateAudioCue({ state, input: { kind: 'request', request: request() } });
    expect(state.active).toBeUndefined();
    expect(state.suspended).toEqual([]);
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
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:combat',
          authored: false,
        }),
      },
    });
    expect(second.reason).toBe('admitted-higher-priority');
    expect(second.play?.url).toBe('blob:combat');
    expect(second.state.suspended.map((cue) => cue.url)).toEqual(['blob:village-theme']);
  });

  test('a scripted cue preempts combat and stacks the preempted cue', () => {
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:combat',
          authored: false,
        }),
      },
    });
    const scripted = arbitrateAudioCue({
      state: combat.state,
      input: {
        kind: 'request',
        request: request({
          source: 'scripted',
          context: 'ending.fading_ward',
          url: 'blob:stinger',
        }),
      },
    });
    expect(scripted.reason).toBe('admitted-higher-priority');
    expect(scripted.play?.url).toBe('blob:stinger');
    expect(scripted.state.suspended.map((cue) => cue.source)).toEqual(['combat']);
  });

  test('a map request never preempts combat', () => {
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:combat',
          authored: false,
        }),
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

  test('a same-url request at a lower priority is still rejected', () => {
    // Priority is applied before playback deduplication: matching bytes must
    // not let a lower band take ownership from a higher one.
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:shared',
          authored: true,
        }),
      },
    });
    const map = arbitrateAudioCue({
      state: combat.state,
      input: { kind: 'request', request: request({ context: 'village', url: 'blob:shared' }) },
    });
    expect(map.reason).toBe('rejected-lower-priority');
    expect(map.state.active?.source).toBe('combat');
  });

  test('a map change while preempted refreshes the cue to restore', () => {
    const map = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'village' }) },
    });
    const combat = arbitrateAudioCue({
      state: map.state,
      input: {
        kind: 'request',
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:combat',
          authored: false,
        }),
      },
    });
    const moved = arbitrateAudioCue({
      state: combat.state,
      input: { kind: 'request', request: request({ context: 'inn', url: 'blob:inn-theme' }) },
    });
    expect(moved.state.active?.source).toBe('combat');
    expect(moved.state.suspended.map((cue) => cue.context)).toEqual(['inn']);
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

describe('arbitrateAudioCue — declared silence', () => {
  test('authored silence is admitted as a stop, not a no-op', () => {
    const decision = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'inn', url: null, authored: true }) },
    });
    expect(decision.reason).toBe('admitted-silence');
    expect(decision.stop).toBe(true);
    expect(decision.state.active?.url).toBeNull();
  });

  test('authored silence preempts a lower-priority generic cue', () => {
    const generic = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ authored: false }) },
    });
    const silent = arbitrateAudioCue({
      state: generic.state,
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: null, authored: true }),
      },
    });
    expect(silent.reason).toBe('admitted-silence');
    expect(silent.stop).toBe(true);
    expect(silent.state.active?.source).toBe('combat');
  });

  test('a generic DJ cue cannot replace intentional authored silence', () => {
    const silent = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'inn', url: null, authored: true }) },
    });
    const dj = arbitrateAudioCue({
      state: silent.state,
      input: {
        kind: 'request',
        request: request({ context: 'dj:mood', url: 'blob:dj-pick', authored: false }),
      },
    });
    expect(dj.reason).toBe('rejected-authored-cue');
    expect(dj.state.active?.url).toBeNull();
  });

  test('an unauthored null url is a cue miss and changes nothing', () => {
    const first = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    const miss = arbitrateAudioCue({
      state: first.state,
      input: { kind: 'request', request: request({ url: null, authored: false }) },
    });
    expect(miss.reason).toBe('rejected-empty-url');
    expect(miss.stop).toBe(false);
    expect(miss.play).toBeUndefined();
    expect(miss.state.active?.url).toBe('blob:village-theme');
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

  test('the same rendition played for an authored reason upgrades the record', () => {
    const generic = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({ context: 'explore', authored: false }),
      },
    });
    expect(generic.state.active?.authored).toBe(false);

    const authored = arbitrateAudioCue({
      state: generic.state,
      input: { kind: 'request', request: request({ context: 'village', authored: true }) },
    });
    expect(authored.reason).toBe('no-change');
    expect(authored.play).toBeUndefined();
    expect(authored.state.active).toMatchObject({
      context: 'village',
      authored: true,
      url: 'blob:village-theme',
    });
  });

  test('an authored cue already on is not downgraded by a generic repeat', () => {
    const authored = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'village', authored: true }) },
    });
    const generic = arbitrateAudioCue({
      state: authored.state,
      input: { kind: 'request', request: request({ context: 'explore', authored: false }) },
    });
    // Priority/ownership is decided before playback deduplication, so the
    // generic repeat is rejected rather than silently absorbed.
    expect(generic.reason).toBe('rejected-authored-cue');
    expect(generic.state.active).toMatchObject({ context: 'village', authored: true });
  });

  test('a second map declaring the same rendition still moves the record', () => {
    const first = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'old_road', authored: true }) },
    });
    const second = arbitrateAudioCue({
      state: first.state,
      input: { kind: 'request', request: request({ context: 'ruined_shrine', authored: true }) },
    });
    expect(second.reason).toBe('no-change');
    expect(second.play).toBeUndefined();
    expect(second.state.active?.context).toBe('ruined_shrine');
  });

  test('releasing combat restores the suspended map cue', () => {
    const map = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    const combat = arbitrateAudioCue({
      state: map.state,
      input: {
        kind: 'request',
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:combat',
          authored: false,
        }),
      },
    });
    const released = arbitrateAudioCue({
      state: combat.state,
      input: { kind: 'release', source: 'combat' },
    });
    expect(released.reason).toBe('released-restored');
    expect(released.play?.url).toBe('blob:village-theme');
    expect(released.state.active?.source).toBe('map');
    expect(released.state.suspended).toEqual([]);
  });

  test('map -> combat A -> combat B -> release restores the map', () => {
    const map = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'village' }) },
    });
    const combatA = arbitrateAudioCue({
      state: map.state,
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat-a' }),
      },
    });
    const combatB = arbitrateAudioCue({
      state: combatA.state,
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat-b' }),
      },
    });
    expect(combatB.state.suspended.map((cue) => cue.context)).toEqual(['village']);
    const released = arbitrateAudioCue({
      state: combatB.state,
      input: { kind: 'release', source: 'combat' },
    });
    expect(released.play?.context).toBe('village');
    expect(released.state.suspended).toEqual([]);
  });

  test('map -> combat -> scripted -> script release -> combat release restores in order', () => {
    const map = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request({ context: 'village' }) },
    });
    const combat = arbitrateAudioCue({
      state: map.state,
      input: {
        kind: 'request',
        request: request({ source: 'combat', context: 'combat', url: 'blob:combat' }),
      },
    });
    const scripted = arbitrateAudioCue({
      state: combat.state,
      input: {
        kind: 'request',
        request: request({
          source: 'scripted',
          context: 'ending.fading_ward',
          url: 'blob:stinger',
        }),
      },
    });
    // Scripted release during combat restores combat, not the map.
    const scriptReleased = arbitrateAudioCue({
      state: scripted.state,
      input: { kind: 'release', source: 'scripted' },
    });
    expect(scriptReleased.play?.source).toBe('combat');
    // Combat release then restores the map.
    const combatReleased = arbitrateAudioCue({
      state: scriptReleased.state,
      input: { kind: 'release', source: 'combat' },
    });
    expect(combatReleased.play?.context).toBe('village');
  });

  test('releasing a source that is not active is a no-op', () => {
    const map = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: { kind: 'request', request: request() },
    });
    const released = arbitrateAudioCue({
      state: map.state,
      input: { kind: 'release', source: 'combat' },
    });
    expect(released.reason).toBe('release-noop');
    expect(released.play).toBeUndefined();
    expect(released.state.active?.url).toBe('blob:village-theme');
  });

  test('releasing combat with nothing suspended leaves no active cue', () => {
    const combat = arbitrateAudioCue({
      state: createAudioCueArbiterState(),
      input: {
        kind: 'request',
        request: request({
          source: 'combat',
          context: 'combat',
          url: 'blob:combat',
          authored: false,
        }),
      },
    });
    const released = arbitrateAudioCue({
      state: combat.state,
      input: { kind: 'release', source: 'combat' },
    });
    expect(released.reason).toBe('released-empty');
    expect(released.play).toBeUndefined();
    expect(released.state.active).toBeUndefined();
  });
});
