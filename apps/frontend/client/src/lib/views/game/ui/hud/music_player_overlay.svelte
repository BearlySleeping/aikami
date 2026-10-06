<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/music_player_overlay.svelte
//
// Optional in-game music player mini-overlay. Shows the currently playing
// track, the scene vibe, and play/pause, stop, and vibe-skip controls.
//
// 🔴 Whether it shows is owned by the HUD resolver: the `music-player` widget
// is placed by the C-528 layout policy, and this component only paints when
// that policy plus its own Hide control say so. The legacy Audio settings
// switch is an adapter over the same authority.
//
// Contract: C-150 (audio engine), C-249 (music tags), C-528 (HUD authority)

import { BaseViewModelContainer } from '$components';
import { getMusicPlayerViewModel } from './music_player_composition.ts';
import type { MusicPlayerViewModelInterface } from './music_player_view_model.svelte';

type Props = {
  viewModel?: MusicPlayerViewModelInterface;
};

const { viewModel = getMusicPlayerViewModel({ className: 'MusicPlayerVM' }) }: Props = $props();

/** Tooltip label for the play/pause control. */
const playPauseTitle = $derived.by(() => {
  if (viewModel.isPlaying) {
    return 'Pause';
  }
  if (viewModel.isPaused) {
    return 'Resume';
  }
  return 'Play';
});
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.visible}
    <section
      class="pointer-events-auto flex w-64 max-w-full flex-col gap-1 rounded-xl border border-base-content/10 bg-base-200/90 p-3 shadow-2xl backdrop-blur-md"
      aria-label="Music player"
      data-testid="music-player-overlay"
    >
      <!-- Header: track + vibe badge -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p
            class="truncate text-sm font-bold text-primary {viewModel.hasActiveTrack ? '' : 'text-base-content/40'}"
            title={viewModel.currentTrackTitle}
          >
            🎵 {viewModel.currentTrackTitle}
          </p>
          <p class="mt-0.5 text-[11px] font-medium tracking-wide text-base-content/50 uppercase">
            {viewModel.vibeLabel}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-circle shrink-0"
          onclick={() => viewModel.hide()}
          aria-label="Hide music player"
          title="Hide music player"
        >
          ✕
        </button>
      </div>

      <!-- Controls: play/pause, stop, skip -->
      <div class="mt-1 flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-sm btn-circle"
          onclick={() => viewModel.togglePlayPause()}
          aria-label={viewModel.isPlaying ? 'Pause music' : 'Play music'}
          title={playPauseTitle}
        >
          {#if viewModel.isPlaying}
            ⏸
          {:else if viewModel.isPaused}
            ▶️
          {:else}
            ▶
          {/if}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          onclick={() => viewModel.stop()}
          aria-label="Stop music"
          title="Stop music"
        >
          ⏹
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          onclick={() => viewModel.skip()}
          aria-label="Skip to similar song"
          title={viewModel.hasSimilarTracks
  ? 'Play another song matching this vibe'
  : 'No other similar track available'}
          disabled={!viewModel.hasSimilarTracks}
        >
          ⏭
        </button>

        <!-- Skip hint (when no similar track) -->
        {#if viewModel.feedback}
          <span class="ml-1 min-w-0 flex-1 truncate text-[11px] text-warning" aria-live="polite">
            {viewModel.feedback}
          </span>
        {:else if viewModel.silentBecause}
          <!--
          🔴 A reload never resumes audio on its own, so silence after a visit
          where music was on is otherwise indistinguishable from a broken HUD.
          -->
          <span
            class="ml-1 min-w-0 flex-1 truncate text-[11px] text-base-content/50"
            aria-live="polite"
            data-testid="music-player-silent-because"
          >
            {viewModel.silentBecause}
          </span>
        {:else}
          <span class="ml-1 flex-1 text-right text-[11px] text-base-content/40">
            {viewModel.hasSimilarTracks ? 'similar vibe' : ''}
          </span>
        {/if}
      </div>
    </section>
  {/if}
</BaseViewModelContainer>
