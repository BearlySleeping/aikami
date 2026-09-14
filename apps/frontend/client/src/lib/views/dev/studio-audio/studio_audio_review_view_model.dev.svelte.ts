// apps/frontend/client/src/lib/views/dev/studio-audio/studio_audio_review_view_model.dev.svelte.ts
//
// C-521 AC-4 dev sandbox ViewModel — the Studio audio review panel in a
// controlled state.
//
// The panel only appears in `/studio/assets` once a candidate exists, and a
// candidate requires an audio engine. This sandbox supplies a *deterministic*
// candidate instead: a synthesised 400 Hz stereo loop with authored sample
// bounds, so the waveform, play/pause, loop audition, mute and the live-region
// announcements can be inspected and captured without a GPU.
//
// Contract: C-521 Music and SFX generation with audio preparation

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AudioCandidateReviewOptions } from '$services/audio/audio_candidate_review.svelte';
import { AudioCandidateReview } from '$services/audio/audio_candidate_review.svelte';

const SAMPLE_RATE = 48_000;
/** 400 Hz: a 120-sample period, so a 60-sample half-period is a zero crossing. */
const LOOP_FREQUENCY = 400;
const LOOP_SECONDS = 4;
const LOOP_START_SAMPLE = 0;
const LOOP_END_SAMPLE = 60 * 800;

/** Encodes de-interleaved float channels as a 32-bit float WAV. */
const encodeFloat32Wav = (channelData: readonly Float32Array[]): Blob => {
  const channels = channelData.length;
  const frames = channelData[0]?.length ?? 0;
  const data = new Uint8Array(frames * channels * 4);
  const view = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(
        (frame * channels + channel) * 4,
        (channelData[channel] as Float32Array)[frame] as number,
        true,
      );
    }
  }
  const header = new Uint8Array(44);
  const headerView = new DataView(header.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      header[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, 'RIFF');
  headerView.setUint32(4, 36 + data.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  headerView.setUint32(16, 16, true);
  headerView.setUint16(20, 3, true);
  headerView.setUint16(22, channels, true);
  headerView.setUint32(24, SAMPLE_RATE, true);
  headerView.setUint32(28, SAMPLE_RATE * channels * 4, true);
  headerView.setUint16(32, channels * 4, true);
  headerView.setUint16(34, 32, true);
  ascii(36, 'data');
  headerView.setUint32(40, data.length, true);
  return new Blob([header, data], { type: 'audio/wav' });
};

/** Builds the synthetic loop candidate used by the sandbox. */
const buildCandidate = (): Blob => {
  const frames = LOOP_SECONDS * SAMPLE_RATE;
  const channels = [0, 1].map((channelIndex) => {
    const channel = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      const amplitude = channelIndex === 0 ? 0.25 : 0.18;
      channel[frame] = amplitude * Math.sin((2 * Math.PI * LOOP_FREQUENCY * frame) / SAMPLE_RATE);
    }
    return channel;
  });
  return encodeFloat32Wav(channels);
};

/** The sandbox ViewModel surface. */
export type StudioAudioReviewDevViewModelInterface = BaseViewModelInterface & {
  readonly review: AudioCandidateReview;
  readonly candidateLabel: string;
  readonly loopDescription: string;
  /** Re-decodes the same candidate (exercises the load path again). */
  reload(): Promise<void>;
};

/** Options accepted by {@link StudioAudioReviewDevViewModel.create}. */
export type StudioAudioReviewDevViewModelOptions = BaseViewModelOptions & {
  className: string;
};

/**
 * Dev sandbox ViewModel: loads one deterministic loop candidate into a real
 * `AudioCandidateReview` instance and exposes it to the panel.
 */
export class StudioAudioReviewDevViewModel
  extends BaseViewModel<StudioAudioReviewDevViewModelOptions>
  implements StudioAudioReviewDevViewModelInterface
{
  private static readonly _reviewOptions: AudioCandidateReviewOptions = {
    className: 'AudioCandidateReview',
    enableAutoDebug: false,
  };

  readonly review = AudioCandidateReview.create(StudioAudioReviewDevViewModel._reviewOptions);

  readonly candidateLabel = 'dev/synthetic_loop.webm · .webm · ace-step-v1.5';

  readonly loopDescription =
    `${LOOP_START_SAMPLE}..${LOOP_END_SAMPLE} samples at ${SAMPLE_RATE} Hz (${LOOP_SECONDS}s, 400 Hz zero-crossing seam)`;

  private _objectUrl: string | undefined;

  private _blob: Blob = buildCandidate();

  /** Loads the synthetic candidate into the panel. */
  async reload(): Promise<void> {
    if (this._objectUrl !== undefined) {
      URL.revokeObjectURL(this._objectUrl);
    }
    this._blob = buildCandidate();
    this._objectUrl = URL.createObjectURL(this._blob);
    await this.review.load({
      url: this._objectUrl,
      loop: { loopStartSample: LOOP_START_SAMPLE, loopEndSample: LOOP_END_SAMPLE },
    });
  }

  /** Loads the candidate once the view mounts. */
  async initialize(): Promise<void> {
    await this.reload();
    await super.initialize();
  }

  /** @inheritdoc */
  async dispose(): Promise<void> {
    if (this._objectUrl !== undefined) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = undefined;
    }
    await this.review.dispose();
    await super.dispose();
  }
}

/** Builds the sandbox ViewModel. */
export const getStudioAudioReviewDevViewModel = (
  options: StudioAudioReviewDevViewModelOptions,
): StudioAudioReviewDevViewModelInterface => StudioAudioReviewDevViewModel.create(options);
