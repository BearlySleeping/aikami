<!-- apps/frontend/client/src/lib/views/studio/studio_audio_review.svelte

  C-521 AC-4 — the audio candidate review panel.

  It renders a decoded waveform, a labelled keyboard-reachable play/pause, a
  loop audition toggle, a mute toggle and an `aria-live` status line. All state
  and behaviour come from the injected `audioCandidateReview` service; this
  component only draws and wires.

  Contract: C-521 Music and SFX generation with audio preparation
-->
<script lang="ts">
import type { StudioAudioReview } from '$types';

type Props = {
  review: StudioAudioReview;
  /** Extra context for the status line (tag/engine), supplied by the view. */
  candidateLabel: string;
};

const { review, candidateLabel }: Props = $props();

const WAVEFORM_WIDTH = 480;
const WAVEFORM_HEIGHT = 96;

/** The waveform path, recomputed whenever the envelope changes. */
const waveformPath = $derived.by(() => {
  const peaks = review.peaks;
  if (peaks.length === 0) {
    return '';
  }
  const step = WAVEFORM_WIDTH / Math.max(1, peaks.length - 1);
  return peaks
    .map((peak, index) => {
      const x = (index * step).toFixed(2);
      const amplitude = Math.max(1, peak * (WAVEFORM_HEIGHT / 2 - 2));
      return `M ${x} ${(WAVEFORM_HEIGHT / 2 - amplitude).toFixed(2)} V ${(WAVEFORM_HEIGHT / 2 + amplitude).toFixed(2)}`;
    })
    .join(' ');
});

/** Where the authored loop seam sits, as a percentage of the waveform. */
const loopStartPercent = $derived(
  review.loopStartSeconds !== undefined && review.durationSeconds > 0
    ? (review.loopStartSeconds / review.durationSeconds) * 100
    : undefined,
);

const loopEndPercent = $derived(
  review.loopEndSeconds !== undefined && review.durationSeconds > 0
    ? (review.loopEndSeconds / review.durationSeconds) * 100
    : undefined,
);
</script>

<div class="flex flex-col gap-3 rounded border border-base-300 p-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="text-sm font-semibold">Audio review</h3>
    <span class="text-[10px] font-mono text-base-content/70">{candidateLabel}</span>
  </div>

  <div
    class="relative w-full overflow-hidden rounded bg-base-300"
    data-testid="studio-audio-waveform"
  >
    <svg
      viewBox={`0 0 ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT}`}
      class="h-24 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Decoded waveform of the generated candidate"
    >
      <line
        x1="0"
        y1={WAVEFORM_HEIGHT / 2}
        x2={WAVEFORM_WIDTH}
        y2={WAVEFORM_HEIGHT / 2}
        stroke="currentColor"
        stroke-opacity="0.25"
        stroke-width="1"
      />
      {#if waveformPath.length > 0}
        <path d={waveformPath} stroke="currentColor" stroke-width="1" fill="none" />
      {/if}
      {#if loopStartPercent !== undefined}
        <rect
          x={(loopStartPercent / 100) * WAVEFORM_WIDTH}
          y="0"
          width={Math.max(
            1,
            (((loopEndPercent ?? 100) - loopStartPercent) / 100) * WAVEFORM_WIDTH,
          )}
          height={WAVEFORM_HEIGHT}
          fill="currentColor"
          fill-opacity="0.12"
        />
      {/if}
    </svg>
    {#if !review.loaded}
      <p class="absolute inset-0 flex items-center justify-center text-xs text-base-content/60">
        {review.errorMessage.length > 0 ? 'Waveform unavailable' : 'Decoding candidate…'}
      </p>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="btn btn-sm btn-primary"
      id="studio-audio-play"
      data-testid="studio-audio-play"
      aria-pressed={review.playing}
      disabled={!review.loaded}
      onclick={() => review.togglePlayback()}
    >
      {review.playing ? 'Pause' : 'Play'}
    </button>

    <button
      type="button"
      class="btn btn-sm"
      id="studio-audio-loop"
      data-testid="studio-audio-loop"
      aria-pressed={review.looping}
      disabled={!review.canLoop}
      onclick={() => review.toggleLoop()}
    >
      Loop audition
    </button>

    <button
      type="button"
      class="btn btn-sm"
      id="studio-audio-mute"
      data-testid="studio-audio-mute"
      aria-pressed={review.muted}
      disabled={!review.loaded}
      onclick={() => review.toggleMute()}
    >
      {review.muted ? 'Unmute' : 'Mute'}
    </button>

    <span class="text-[10px] font-mono text-base-content/70">
      {review.durationSeconds.toFixed(2)}s · {review.sampleRate} Hz
    </span>
  </div>

  {#if review.loaded && !review.canLoop}
    <p class="text-xs text-base-content/60">
      This candidate declares no loop sample bounds, so loop audition stays disabled — a loop the
      author did not bound is not one this panel can prove repeats cleanly.
    </p>
  {/if}

  {#if review.statusLabel.length > 0}
    <p class="sr-only" role="status" aria-live="polite" data-testid="studio-audio-status">
      {review.statusLabel}
    </p>
  {/if}

  {#if review.errorMessage}
    <p class="text-xs text-error" role="alert" data-testid="studio-audio-error">
      {review.errorMessage}
    </p>
  {/if}
</div>
