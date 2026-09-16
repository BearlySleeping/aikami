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
// A request at a higher rank preempts and *suspends* the active map cue so a
// release can restore it. A request at an equal rank is admitted only when it
// is not competing with an authored binding — an unauthored (DJ / generic)
// pick never displaces an authored map cue, which is the concrete failure the
// contract calls out.
//
// Explicit authored silence is a real action, not an absent url: it holds its
// band's authority (so a generic DJ pick cannot replace intentional silence)
// and asks the caller to fade out. Priority is applied *before* playback
// deduplication, so a same-url request cannot bypass ownership or restoration.
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
  /**
   * The resolved playback URL, or null for declared silence.
   *
   * A null URL is a valid stop request when the pack authored silence for this
   * context, or when `intent` is explicitly `'stop'` (an autonomous pause). A
   * plain unauthored null is a cue miss and never reaches the authority as a
   * state change.
   */
  url: string | null;
  /** True only when the URL came from an authored pack binding. */
  authored: boolean;
  /** `'stop'` requests fade the active BGM to silence. Defaults to `'play'`. */
  intent?: 'play' | 'stop';
};

/** The arbiter's serializable state. */
type AudioCueArbiterState = {
  /** The cue currently holding the authority, when any. */
  active: AudioCueRequest | undefined;
  /**
   * Cues preempted by a higher-priority request, oldest first. A stack rather
   * than a single slot so `map -> combat -> scripted` restores combat on the
   * scripted release and the map on the combat release.
   */
  suspended: AudioCueRequest[];
};

/** Why the authority admitted, rejected or ignored an input. */
type AudioCueDecisionReason =
  | 'admitted-first'
  | 'admitted-higher-priority'
  | 'admitted-context-change'
  | 'admitted-unauthored'
  | 'admitted-silence'
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
  /**
   * True when the caller must fade the active BGM out (declared silence).
   * Distinct from `play: undefined`, which means "leave playback alone".
   */
  stop: boolean;
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
  suspended: [],
});

/**
 * True when the request is an explicit stop (authored silence, or an
 * autonomous pause) rather than a cue miss.
 */
const isStopRequest = (request: AudioCueRequest): boolean =>
  request.intent === 'stop' || (request.url === null && request.authored);

/** The priority of a request. */
const priorityOf = (request: AudioCueRequest): number => AUDIO_CUE_SOURCE_PRIORITY[request.source];

/** Why an equal-priority request was admitted. */
const equalPriorityReason = (options: {
  active: AudioCueRequest;
  request: AudioCueRequest;
  stopRequest: boolean;
}): AudioCueDecisionReason => {
  const { active, request, stopRequest } = options;
  if (stopRequest && !active.authored) {
    return 'admitted-silence';
  }
  if (active.authored && request.authored) {
    return 'admitted-context-change';
  }
  return 'admitted-unauthored';
};

/**
 * Runs one arbitration step.
 *
 * @param options.state - The current arbiter state (never mutated).
 * @param options.input - A cue request or a source release.
 * @returns The cue to play (if any), whether to stop, the reason, and the next state.
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
  const stopRequest = isStopRequest(request);

  // An unauthored cue miss resolves to silence *outside* the authority — it is
  // a no-op, never a request to stop the current track.
  if (request.url === null && !stopRequest) {
    return { play: undefined, stop: false, reason: 'rejected-empty-url', state };
  }

  if (!state.active) {
    return {
      play: request,
      stop: stopRequest,
      reason: stopRequest ? 'admitted-silence' : 'admitted-first',
      state: { active: request, suspended: state.suspended },
    };
  }

  const activePriority = priorityOf(state.active);
  const requestPriority = priorityOf(request);

  // Priority first: a lower band never displaces a higher one, even when the
  // url happens to match.
  if (requestPriority < activePriority) {
    // A map moving while a higher band is active refreshes the cue a later
    // release will restore, without touching the active higher band.
    if (
      request.source === 'map' &&
      !stopRequest &&
      state.suspended.some((cue) => cue.source === 'map')
    ) {
      return {
        play: undefined,
        stop: false,
        reason: 'rejected-lower-priority',
        state: {
          active: state.active,
          suspended: state.suspended.map((cue) => (cue.source === 'map' ? request : cue)),
        },
      };
    }
    return { play: undefined, stop: false, reason: 'rejected-lower-priority', state };
  }

  if (requestPriority === activePriority) {
    if (state.active.authored && !request.authored) {
      // The DJ (or any generic pick) must not displace an authored cue.
      return { play: undefined, stop: false, reason: 'rejected-authored-cue', state };
    }

    const sameUrl = state.active.url !== null && state.active.url === request.url;
    if (sameUrl) {
      // Same bytes — nothing new to play. The *record* still has to describe
      // the current context and the most specific provenance: two different
      // maps can legitimately declare the same rendition, and an authored
      // binding can resolve to the same track a generic tag match would have
      // picked. Keeping the older record would make `getActiveAudioCue()`
      // report the previous map, or report an authored cue as unprovenanced.
      //
      // A generic repeat never *downgrades* an authored record — losing the
      // "the pack declared this" provenance would be strictly less information.
      const shouldRefresh =
        request.authored && (!state.active.authored || request.context !== state.active.context);
      const genericContextChange =
        !request.authored && !state.active.authored && request.context !== state.active.context;
      if (shouldRefresh || genericContextChange) {
        return {
          play: undefined,
          stop: false,
          reason: 'no-change',
          state: { suspended: state.suspended, active: request },
        };
      }
      return { play: undefined, stop: false, reason: 'no-change', state };
    }

    // Equal-priority admission preserves any suspended map cue: replacing the
    // active same-band cue must not erase a map waiting to be restored.
    return {
      play: request,
      stop: stopRequest,
      reason: equalPriorityReason({ active: state.active, request, stopRequest }),
      state: { suspended: state.suspended, active: request },
    };
  }

  // Higher priority: push the preempted cue so a later release restores it,
  // without erasing any cue already suspended by an earlier preemption.
  return {
    play: request,
    stop: stopRequest,
    reason: stopRequest ? 'admitted-silence' : 'admitted-higher-priority',
    state: {
      suspended: [...state.suspended, state.active],
      active: request,
    },
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
    return { play: undefined, stop: false, reason: 'release-noop', state };
  }

  if (state.suspended.length > 0) {
    const restored = state.suspended[state.suspended.length - 1];
    if (restored) {
      return {
        play: restored,
        stop: false,
        reason: 'released-restored',
        state: { active: restored, suspended: state.suspended.slice(0, -1) },
      };
    }
  }

  return {
    play: undefined,
    stop: false,
    reason: 'released-empty',
    state: createAudioCueArbiterState(),
  };
};
