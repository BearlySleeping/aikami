<script lang="ts">
// apps/frontend/client/src/lib/views/dev/audio/audio_view.dev.svelte
//
// Dev sandbox view for testing BGM transitions, SFX playback, and the
// in-game music player (overlay toggle, vibe-matched skip, pause/stop).
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import MusicPlayerOverlay from '$lib/views/game/ui/hud/music_player_overlay.svelte';
import { routerService } from '$services';
import type { DevAudioViewModelInterface } from './audio_view_model.dev.svelte.ts';

type Props = {
  viewModel: DevAudioViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="min-h-screen bg-base-200">
  <div class="max-w-2xl mx-auto p-6 space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">🎵 Dev Audio Sandbox</h1>
        <p class="text-base-content/60 text-sm mt-1">
          Test BGM crossfade, SFX, and the in-game music player (vibe matching, pause/skip/stop).
          <button
            type="button"
            class="link link-primary"
            onclick={() => routerService.goToDevRoute('settings')}
          >
            Go to Dev Settings →
          </button>
          to change volume.
        </p>
      </div>
    </div>

    <!-- Volume Display -->
    <div class="card bg-base-100 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Current Volume</h2>
        <div class="grid grid-cols-3 gap-4 text-center">
          <div>
            <span class="text-xs text-base-content/60">Master</span>
            <div class="text-lg font-mono font-bold">
              {Math.round(viewModel.masterVolume * 100)}%
            </div>
          </div>
          <div>
            <span class="text-xs text-base-content/60">Music</span>
            <div class="text-lg font-mono font-bold">{Math.round(viewModel.bgmVolume * 100)}%</div>
          </div>
          <div>
            <span class="text-xs text-base-content/60">SFX</span>
            <div class="text-lg font-mono font-bold">{Math.round(viewModel.sfxVolume * 100)}%</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Music Player (C-249) ── -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <div class="flex items-center justify-between">
          <h2 class="card-title">🎧 Music Player</h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/50">Show overlay</span>
            <input
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
              checked={viewModel.musicPlayerVisible}
              onchange={() => viewModel.toggleMusicPlayer()}
              aria-label="Toggle music player overlay"
            >
          </div>
        </div>
        <p class="text-base-content/60 text-sm">
          Toggle the in-game mini player (renders bottom-left like in-game). Skip picks another
          track matching the current vibe.
        </p>

        <!-- Now playing -->
        <div class="mt-3 flex items-center gap-3 rounded-xl bg-base-200 p-3">
          <div class="text-2xl">🎵</div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-bold text-primary">{viewModel.currentTrackTitle}</p>
            <p class="text-xs text-base-content/50 uppercase tracking-wide">
              {viewModel.vibeLabel}
            </p>
          </div>
          <span class="badge badge-ghost badge-sm font-mono">{viewModel.vibeTags.join(' · ')}</span>
        </div>

        <!-- Transport controls -->
        <div class="mt-3 flex items-center gap-2">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onclick={() =>
              viewModel.isPaused
                ? viewModel.resumeMusic()
                : viewModel.isPlaying
                  ? viewModel.pauseMusic()
                  : viewModel.skipMusic()}
          >
            {viewModel.isPaused ? '▶️ Resume' : viewModel.isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => viewModel.stopMusic()}>
            ⏹ Stop
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.skipMusic()}
            title="Play another track matching the vibe"
          >
            ⏭ Skip (vibe)
          </button>
          <span class="ml-1 text-xs text-base-content/50">
            {viewModel.hasSimilarTracks ? 'similar track available' : 'no similar track'}
          </span>
        </div>

        <!-- Vibe presets -->
        <div class="mt-4">
          <p class="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
            Vibe presets — test vibe-matched skipping
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each viewModel.scenePresets as preset}
              <button
                type="button"
                class="btn btn-xs {viewModel.vibeLabel.toLowerCase().includes(preset.id)
                  ? 'btn-active btn-accent'
                  : 'btn-outline'}"
                onclick={() => viewModel.setScenePreset(preset.id)}
              >
                {preset.icon} {preset.label}
              </button>
            {/each}
            <button
              type="button"
              class="btn btn-xs btn-outline"
              onclick={() => viewModel.resetToLiveScene()}
            >
              🎮 Live Scene
            </button>
          </div>
        </div>

        <!-- Track list -->
        <div class="mt-4">
          <p class="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
            Library ({viewModel.tracks.length})
          </p>
          <div class="mt-2 flex flex-col gap-1.5">
            {#each viewModel.tracks as track (track.id)}
              <div class="flex items-center gap-2 rounded-lg bg-base-200 px-3 py-2">
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={() => viewModel.playTrack(track)}
                >
                  ▶
                </button>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{track.title}</p>
                  <p class="truncate font-mono text-[11px] text-base-content/50">
                    {track.tags.join(', ')}
                  </p>
                </div>
              </div>
            {/each}
            {#if viewModel.tracks.length === 0}
              <p class="text-sm text-base-content/40 italic">No tracks discovered yet…</p>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- BGM Controls -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">🎼 Background Music</h2>
        <p class="text-base-content/60 text-sm">
          Crossfade between exploration and combat tracks with Equal-Power transitions.
        </p>
        <div class="flex gap-3 mt-2">
          <button
            type="button"
            class="btn btn-primary flex-1"
            onclick={() => viewModel.playExploreBgm()}
          >
            🌲 Explore BGM
          </button>
          <button
            type="button"
            class="btn btn-error flex-1"
            onclick={() => viewModel.playCombatBgm()}
          >
            ⚔️ Combat BGM
          </button>
        </div>
      </div>
    </div>

    <!-- SFX Controls -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">💥 Sound Effects</h2>
        <p class="text-base-content/60 text-sm">Fire-and-forget concurrent SFX playback.</p>
        <div class="flex gap-3 mt-2">
          <button
            type="button"
            class="btn btn-warning flex-1"
            onclick={() => viewModel.playHitSfx()}
          >
            🔨 Hit SFX
          </button>
          <button
            type="button"
            class="btn btn-success flex-1"
            onclick={() => viewModel.playPickupSfx()}
          >
            💎 Pickup SFX
          </button>
        </div>
      </div>
    </div>

    <!-- Stop & Status -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="card-title text-base">Status</h2>
            {#if viewModel.isCrossfading}
              <span class="badge badge-warning gap-1 mt-1">
                <span class="loading loading-spinner loading-xs"></span>
                Crossfading…
              </span>
            {/if}
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick={() => viewModel.stopAll()}>
            ⏹ Stop All
          </button>
        </div>
        <div
          class="mt-3 py-2 px-3 bg-base-200 rounded-lg text-sm font-mono"
          class:text-success={viewModel.feedback.includes('Playing')}
        >
          {viewModel.feedback}
        </div>
      </div>
    </div>

    <!-- Quick nav -->
    <div class="text-center pb-4">
      <button
        type="button"
        class="btn btn-outline btn-wide"
        onclick={() => routerService.goToDevRoute('settings')}
      >
        ⚙️ Dev Settings (Change Volume)
      </button>
    </div>
  </div>

  <!-- Real in-game music player overlay (positioned bottom-left like in-game) -->
  <MusicPlayerOverlay />
</BaseViewModelContainer>
