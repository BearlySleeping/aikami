<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/audio/audio_view.dev.svelte
  //
  // Dev sandbox view for testing BGM transitions and SFX playback.
  // Buttons trigger AudioService methods via the DevAudioViewModel.
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
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
          Test BGM crossfade transitions and SFX playback.
          <a href="/dev/settings" class="link link-primary">Go to Dev Settings →</a>
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

    <!-- BGM Controls -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">🎼 Background Music</h2>
        <p class="text-base-content/60 text-sm">
          Crossfade between exploration and combat tracks with Equal-Power transitions.
        </p>
        <div class="flex gap-3 mt-2">
          <button class="btn btn-primary flex-1" onclick={() => viewModel.playExploreBgm()}>
            🌲 Explore BGM
          </button>
          <button class="btn btn-error flex-1" onclick={() => viewModel.playCombatBgm()}>
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
          <button class="btn btn-warning flex-1" onclick={() => viewModel.playHitSfx()}>
            🔨 Hit SFX
          </button>
          <button class="btn btn-success flex-1" onclick={() => viewModel.playPickupSfx()}>
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
          <button class="btn btn-outline btn-sm" onclick={() => viewModel.stopAll()}>
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
      <a href="/dev/settings" class="btn btn-outline btn-wide"> ⚙️ Dev Settings (Change Volume) </a>
    </div>
  </div>
</BaseViewModelContainer>
