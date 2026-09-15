// apps/frontend/client/src/lib/services/audio/audio_cue_arbiter.ts
//
// C-523 AC-3 — the single arbitration authority for audio cue playback.
//
// Today the Music DJ agent and the map/combat scene cues each drive
// `audioService.transitionToBgm()` directly, so an LLM mood pick and a map
// cue can start competing tracks. This module is the one gate every music
// request passes through, with the deterministic priority the contract names:
//
//   explicit scripted cue (3) > authoritative combat state (2) > map (1)
//
// A request at a higher rank preempts and *suspends* the active cue so a
// release can restore it. A request at an equal rank is admitted only when it
// is not competing with an authored binding — an unauthored (DJ / generic)
// pick never displaces an authored map cue, which is the concrete failure the
// contract calls out.
//
// Pure and state-in/state-out: the caller owns the state value, so the whole
// decision table is testable without an AudioContext.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

/** How a cue request entered the authority. */
const AUDIO_CUE_SOURCES = ['map', 'combat', 'scripted'] as const;

/** A cue request source. */
type AudioCueSource = (typeof AUDIO_CUE_SOURCES)[number];

/**
 * Deterministic priority. Higher wins.
 *
 * `map` covers authored map/ambience bindings *and* generic/DJ picks — the
 * authored flag, not a fourth rank, separates them.
 */
const AUDIO_CUE_SOURCE_PRIORITY: Record<AudioCueSource, number> = {
  map: 1,
  combat: 2,
  scripted: 3,
};

/** A cue the authority is tracking. */
type AudioCueRequest = {
  /** Which priority band the request belongs to. */
  source: AudioCueSource;
  /** Map id, `combat`, `dj:<mood>`, or a scripted predicate id. */
  context: string;
  /** The resolved playback URL, or null for a declared cue miss. */
  url: string | null;
  /** True only when the URL came from an authored pack binding. */
  authored: boolean;
};

/** The arbiter's serializable state. */
type AudioCueArbiterState = {
  /** The cue currently holding the authority, when any. */
  active: AudioCueRequest | undefined;
  /** A preempted map-level cue to restore when the preemptor releases. */
  suspended: AudioCueRequest | undefined;
};

/** Why the authority admitted, rejected or ignored an input. */
type AudioCueDecisionReason =
  | 'admitted-first'
  | 'admitted-higher-priority'
  | 'admitted-context-change'
  | 'admitted-unauthored'
  | 'rejected-lower-priority'
  | 'rejected-authored-cue'
  | 'rejected-empty-url'
  | 'no-change'
  | 'released-restored'
  | 'released-empty'
  | 'release-noop';

/** The outcome of one arbitration step. */
type AudioCueDecision = {
  /** What the caller should play, or undefined when nothing changes. */
  play: AudioCueRequest | undefined;
  /** Why. */
  reason: AudioCueDecisionReason;
  /** The state to carry into the next step. */
  state: AudioCueArbiterState;
};

/** One arbitration input. */
type AudioCueArbiterInput =
  | { kind: 'request'; request: AudioCueRequest }
  | { kind: 'release'; source: AudioCueSource };

/** A fresh, empty arbiter state. */
export const createAudioCueArbiterState = (): AudioCueArbiterState => ({
  active: undefined,
  suspended: undefined,
});

/** The priority of a request. */
const priorityOf = (request: AudioCueRequest): number => AUDIO_CUE_SOURCE_PRIORITY[request.source];

/**
 * Runs one arbitration step.
 *
 * @param options.state - The current arbiter state (never mutated).
 * @param options.input - A cue request or a source release.
 * @returns The cue to play (if any), the reason, and the next state.
 */
export const arbitrateAudioCue = (options: {
  state: AudioCueArbiterState;
  input: AudioCueArbiterInput;
}): AudioCueDecision => {
  const { state, input } = options;

  if (input.kind === 'release') {
    return _release({ state, source: input.source });
  }

  const { request } = input;

  // A declared cue miss resolves to silence before it reaches the authority —
  // an empty URL must never replace a playing cue.
  if (!request.url) {
    return { play: undefined, reason: 'rejected-empty-url', state };
  }

  if (!state.active) {
    return { play: request, reason: 'admitted-first', state: { ...state, active: request } };
  }

  if (state.active.url === request.url) {
    return { play: undefined, reason: 'no-change', state };
  }

  const activePriority = priorityOf(state.active);
  const requestPriority = priorityOf(request);

  if (requestPriority > activePriority) {
    return {
      play: request,
      reason: 'admitted-higher-priority',
      state: {
        // Only a map-level cue is worth restoring; a preempted scripted cue is
        // consumed, not replayed.
        suspended: state.active.source === 'map' ? state.active : undefined,
        active: request,
      },
    };
  }

  if (requestPriority < activePriority) {
    return { play: undefined, reason: 'rejected-lower-priority', state };
  }

  // Equal priority.
  if (state.active.authored && !request.authored) {
    // The DJ (or any generic pick) must not displace an authored map cue.
    return { play: undefined, reason: 'rejected-authored-cue', state };
  }

  if (state.active.authored && request.authored) {
    return {
      play: request,
      reason: 'admitted-context-change',
      state: { suspended: undefined, active: request },
    };
  }

  return {
    play: request,
    reason: 'admitted-unauthored',
    state: { suspended: undefined, active: request },
  };
};

/**
 * Releases a priority band, restoring a suspended map cue when there is one.
 *
 * Combat ending is the motivating case: the map cue suspended by the combat
 * preemption comes back, so exploration is restored without a second lookup.
 */
const _release = (options: {
  state: AudioCueArbiterState;
  source: AudioCueSource;
}): AudioCueDecision => {
  const { state, source } = options;

  if (state.active?.source !== source) {
    return { play: undefined, reason: 'release-noop', state };
  }

  if (state.suspended) {
    return {
      play: state.suspended,
      reason: 'released-restored',
      state: { active: state.suspended, suspended: undefined },
    };
  }

  return { play: undefined, reason: 'released-empty', state: createAudioCueArbiterState() };
};
