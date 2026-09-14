// apps/frontend/client/src/lib/services/audio/audio_candidate_review.svelte.ts
//
// C-521 AC-4 — the decoded-buffer player behind the Studio audio review panel.
//
// A decoded `AudioBuffer` is the reason this exists instead of an `<audio>`
// element: the contract asks to "prefer decoded AudioBuffer scheduling for
// exact loops when supported". An `AudioBufferSourceNode` with authored
// `loopStart`/`loopEnd` repeats without the encoder delay and re-buffer gap an
// element's `loop` attribute introduces, and the same buffer supplies the
// waveform the reviewer looks at.
//
// Layer rules: this is a service, so it holds state and behaviour only. The
// peak envelope lives in `@aikami/local-ai`, the announcement copy in
// `studio_audio_messages.ts`, and the panel in `studio_audio_review.svelte`.
// It fetches the candidate's own object URL — a ViewModel never does.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services/base';
import { type AudioPeaks, computeWaveformPeaks, sampleToSeconds } from '@aikami/local-ai';
import {
  describeAudioReviewFailure,
  describeAudioReviewStatus,
} from '$utils/studio_audio_messages';
import { audioContextManager } from './audio_context_manager.ts';

/** The service surface the review panel reads. */
export type AudioCandidateReviewInterface = BaseFrontendClassInterface & {
  readonly peaks: AudioPeaks;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly loopStartSeconds: number | undefined;
  readonly loopEndSeconds: number | undefined;
  readonly loaded: boolean;
  readonly playing: boolean;
  readonly looping: boolean;
  readonly muted: boolean;
  readonly errorMessage: string;
  readonly statusLabel: string;
  readonly canLoop: boolean;
  load(options: {
    url: string;
    loop?: { loopStartSample: number; loopEndSample: number } | undefined;
  }): Promise<void>;
  togglePlayback(): void;
  toggleLoop(): void;
  toggleMute(): void;
  reset(): void;
};

/** Options accepted by {@link AudioCandidateReview.create}. */
export type AudioCandidateReviewOptions = {
  className: string;
  enableAutoDebug?: boolean;
};

/**
 * The Studio audio candidate player. One candidate at a time: loading a new
 * candidate stops and releases the previous source, so two tracks can never
 * overlap in the review panel.
 */
export class AudioCandidateReview
  extends BaseFrontendClass<AudioCandidateReviewOptions>
  implements AudioCandidateReviewInterface
{
  /** Peak envelope of the decoded candidate. */
  peaks = $state<AudioPeaks>([]);

  /** Decoded duration in seconds. */
  durationSeconds = $state(0);

  /** Decoded sample rate, for reporting sample bounds in seconds. */
  sampleRate = $state(0);

  /** Authored loop bounds in seconds, when the candidate declares them. */
  loopStartSeconds = $state<number | undefined>(undefined);

  loopEndSeconds = $state<number | undefined>(undefined);

  /** True once a candidate has been decoded into a buffer. */
  loaded = $state(false);

  playing = $state(false);

  looping = $state(false);

  muted = $state(false);

  /** Decode/runtime failure, worded for the panel's `role="alert"`. */
  errorMessage = $state('');

  private _buffer: AudioBuffer | undefined;

  private _source: AudioBufferSourceNode | undefined;

  private _gain: GainNode | undefined;

  /** True while the in-flight `load()` is the newest one. */
  private _loadToken = 0;

  /** The spoken status, rendered in an `aria-live` region. */
  get statusLabel(): string {
    return describeAudioReviewStatus({
      loaded: this.loaded,
      playing: this.playing,
      looping: this.looping,
      muted: this.muted,
      durationSeconds: this.durationSeconds,
      ...(this.loopStartSeconds === undefined ? {} : { loopStartSeconds: this.loopStartSeconds }),
      ...(this.loopEndSeconds === undefined ? {} : { loopEndSeconds: this.loopEndSeconds }),
    });
  }

  /** Whether authored loop bounds exist and can be auditioned. */
  get canLoop(): boolean {
    const start = this.loopStartSeconds;
    const end = this.loopEndSeconds;
    return this.loaded && start !== undefined && end !== undefined && end > start;
  }

  /**
   * Decodes a candidate object URL and prepares the review buffer.
   *
   * @param options.url - The candidate's object URL (owned by the workflow).
   * @param options.loop - Authored loop bounds in samples, for a loop candidate.
   */
  async load(options: {
    url: string;
    loop?: { loopStartSample: number; loopEndSample: number } | undefined;
  }): Promise<void> {
    this._loadToken += 1;
    const token = this._loadToken;
    this.errorMessage = '';
    this._stopSource();
    try {
      const response = await fetch(options.url);
      if (!response.ok) {
        throw new Error(`fetch returned ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const buffer = await audioContextManager.context.decodeAudioData(bytes);
      if (token !== this._loadToken) {
        // A newer load superseded this one — never clobber its state.
        return;
      }
      this._buffer = buffer;
      this.durationSeconds = buffer.duration;
      this.sampleRate = buffer.sampleRate;
      this.peaks = computeWaveformPeaks(buffer.getChannelData(0));
      const loop = options.loop;
      this.loopStartSeconds =
        loop === undefined ? undefined : sampleToSeconds(loop.loopStartSample, buffer.sampleRate);
      this.loopEndSeconds =
        loop === undefined ? undefined : sampleToSeconds(loop.loopEndSample, buffer.sampleRate);
      this.looping = false;
      this.loaded = true;
      this.playing = false;
    } catch (error) {
      if (token !== this._loadToken) {
        return;
      }
      this._buffer = undefined;
      this.peaks = [];
      this.loaded = false;
      this.errorMessage = describeAudioReviewFailure(error);
    }
  }

  /**
   * Starts (or restarts) playback from the loop seam, or from the start.
   *
   * Private: the panel exposes a single toggle, so "play" is never a state the
   * UI can put the player into without a matching pause affordance.
   */
  private _play(): void {
    const buffer = this._buffer;
    if (!this.loaded || buffer === undefined) {
      return;
    }
    this._stopSource();
    const context = audioContextManager.context;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = this.muted ? 0 : 1;
    source.connect(gain);
    gain.connect(context.destination);
    const loopStart = this.loopStartSeconds as number | undefined;
    const loopEnd = this.loopEndSeconds as number | undefined;
    const auditioningLoop = this.looping && loopStart !== undefined && loopEnd !== undefined;
    if (auditioningLoop) {
      source.loop = true;
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
    }
    source.onended = (): void => {
      if (this._source === source) {
        this.playing = false;
        this._source = undefined;
      }
    };
    source.start(0, auditioningLoop ? loopStart : 0);
    this._source = source;
    this._gain = gain;
    this.playing = true;
  }

  /** Pauses playback, releasing the source. */
  private _pause(): void {
    this._stopSource();
    this.playing = false;
  }

  /** Toggles playback. */
  togglePlayback(): void {
    if (this.playing) {
      this._pause();
      return;
    }
    this._play();
  }

  /** Toggles loop auditioning; a running source is restarted at the seam. */
  toggleLoop(): void {
    if (!this.canLoop) {
      return;
    }
    this.looping = !this.looping;
    if (this.playing) {
      this._play();
    }
  }

  /** Toggles mute without interrupting the source. */
  toggleMute(): void {
    this.muted = !this.muted;
    if (this._gain !== undefined) {
      this._gain.gain.value = this.muted ? 0 : 1;
    }
  }

  /** Clears the candidate (panel teardown / new generation). */
  reset(): void {
    this._loadToken += 1;
    this._stopSource();
    this._buffer = undefined;
    this.loaded = false;
    this.playing = false;
    this.peaks = [];
    this.durationSeconds = 0;
    this.loopStartSeconds = undefined;
    this.loopEndSeconds = undefined;
    this.errorMessage = '';
  }

  /** @inheritdoc */
  async dispose(): Promise<void> {
    this.reset();
  }

  private _stopSource(): void {
    const source = this._source;
    if (source === undefined) {
      return;
    }
    this._source = undefined;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped — nothing to release.
    }
    source.disconnect();
    this._gain?.disconnect();
    this._gain = undefined;
  }
}

/** The shared review player — one candidate is under review at a time. */
export const audioCandidateReview: AudioCandidateReviewInterface = AudioCandidateReview.create({
  className: 'AudioCandidateReview',
});
