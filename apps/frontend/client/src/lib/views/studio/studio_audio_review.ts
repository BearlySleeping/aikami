// apps/frontend/client/src/lib/views/studio/studio_audio_review.ts

/**
 * C-521: the decoded-buffer audio review surface the Studio feature consumes.
 *
 * The contract stays beside the feature that owns the review view. `$types`
 * re-exports it for compatibility with existing consumers.
 */
export type StudioAudioReview = {
  readonly peaks: readonly number[];
  readonly durationSeconds: number;
  readonly sampleRate: number;
  /** Authored loop bounds in seconds, when the candidate declares them. */
  readonly loopStartSeconds: number | undefined;
  readonly loopEndSeconds: number | undefined;
  readonly loaded: boolean;
  readonly playing: boolean;
  readonly looping: boolean;
  readonly muted: boolean;
  readonly errorMessage: string;
  readonly statusLabel: string;
  readonly announcedStatusLabel: string;
  readonly canLoop: boolean;
  readonly hasWaveform: boolean;
  readonly waveformViewBox: string;
  readonly waveformWidth: number;
  readonly waveformHeight: number;
  readonly waveformCenterY: number;
  readonly waveformPath: string;
  readonly loopRegionX: number | undefined;
  readonly loopRegionWidth: number;
  load(options: {
    url: string;
    loop?: { loopStartSample: number; loopEndSample: number } | undefined;
  }): Promise<void>;
  togglePlayback(): void;
  toggleLoop(): void;
  toggleMute(): void;
  reset(): void;
};
