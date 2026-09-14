// apps/frontend/client/src/lib/utils/studio_audio_messages.ts
//
// C-521 AC-4 — the announcement copy for the Studio audio review panel.
//
// Pure string mapping, kept out of the ViewModel and the service for the same
// reason `studio_outcome_messages.ts` is: the panel owns no phrasing, and an
// `aria-live` region's wording is testable in isolation.
//
// Contract: C-521 Music and SFX generation with audio preparation

/** The observable review state, as the announcement phrase sees it. */
export type AudioReviewAnnouncementState = {
  loaded: boolean;
  playing: boolean;
  looping: boolean;
  muted: boolean;
  durationSeconds: number;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
};

/**
 * Words the review state for a screen reader.
 *
 * AC-4 asks for "status/error announcements", so a state change a sighted user
 * reads from a button's pressed styling must also be spoken.
 */
export const describeAudioReviewStatus = (state: AudioReviewAnnouncementState): string => {
  if (!state.loaded) {
    return 'No audio candidate loaded.';
  }
  const parts: string[] = [];
  parts.push(state.playing ? 'Playing' : 'Paused');
  parts.push(state.muted ? 'muted' : 'unmuted');
  if (state.looping) {
    const bounded =
      state.loopStartSeconds === undefined || state.loopEndSeconds === undefined
        ? ''
        : ` from ${state.loopStartSeconds.toFixed(2)} to ${state.loopEndSeconds.toFixed(2)} seconds`;
    parts.push(`looping${bounded}`);
  }
  parts.push(`${state.durationSeconds.toFixed(2)} seconds long`);
  return `${parts.join(', ')}.`;
};

/** Words a decode failure for the panel's `role="alert"` region. */
export const describeAudioReviewFailure = (error: unknown): string =>
  `This candidate could not be decoded for review: ${
    error instanceof Error ? error.message : String(error)
  }`;
