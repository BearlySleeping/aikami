<!-- apps/frontend/client/src/lib/views/studio/studio_audio_review.svelte

  C-521 AC-4 — the audio candidate review panel.

  It renders a decoded waveform, a labelled keyboard-reachable play/pause, a
  loop audition toggle, a mute toggle and an `aria-live` status line. All state
  and behaviour come from the injected `audioCandidateReview` service; this
  component only draws and wires.

  Contract: C-521 Music and SFX generation with audio preparation
-->
<script lang="ts">
import type { StudioAudioReview } from './studio_audio_review.ts';

type Props = {
  review: StudioAudioReview;
  /** Extra context for the status line (tag/engine), supplied by the view. */
  candidateLabel: string;
};

const { review, candidateLabel }: Props = $props();
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
      viewBox={review.waveformViewBox}
      class="h-24 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Decoded waveform of the generated candidate"
    >
      <line
        x1="0"
        y1={review.waveformCenterY}
        x2={review.waveformWidth}
        y2={review.waveformCenterY}
        stroke="currentColor"
        stroke-opacity="0.25"
        stroke-width="1"
      />
      {#if review.hasWaveform}
        <path d={review.waveformPath} stroke="currentColor" stroke-width="1" fill="none" />
      {/if}
      {#if review.loopRegionX !== undefined}
        <rect
          x={review.loopRegionX}
          y="0"
          width={review.loopRegionWidth}
          height={review.waveformHeight}
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

  <p class="sr-only" role="status" aria-live="polite" data-testid="studio-audio-status">
    {review.announcedStatusLabel}
  </p>

  {#if review.errorMessage}
    <p class="text-xs text-error" role="alert" data-testid="studio-audio-error">
      {review.errorMessage}
    </p>
  {/if}
</div>
