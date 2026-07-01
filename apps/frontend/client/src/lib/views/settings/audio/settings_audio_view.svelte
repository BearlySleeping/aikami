<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/audio/settings_audio_view.svelte
  //
  // Settings > Game > Audio sub-tab. Volume sliders wired to AudioService
  // plus optional test-playback buttons.
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { SettingsAudioViewModelInterface } from './settings_audio_view_model.svelte';

  type Props = {
    viewModel: SettingsAudioViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6">
    <!-- Volume Sliders card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Audio Settings</h2>
        <p class="text-base-content/60">Master volume, sound effects, and music.</p>
        <div class="divider"></div>

        <div class="space-y-4">
          <!-- Master Volume -->
          <div class="form-control">
            <label class="label" for="settings-audio-master">
              <span class="label-text">Master Volume</span>
              <span class="label-text-alt"> {Math.round(viewModel.masterVolume * 100)}% </span>
            </label>
            <input
              id="settings-audio-master"
              type="range"
              min="0"
              max="100"
              value={Math.round(viewModel.masterVolume * 100)}
              class="range"
              oninput={(e) => {
                viewModel.setMasterVolume(Number(e.currentTarget.value) / 100);
              }}
            >
          </div>

          <!-- BGM Volume -->
          <div class="form-control">
            <label class="label" for="settings-audio-bgm">
              <span class="label-text">Music</span>
              <span class="label-text-alt"> {Math.round(viewModel.bgmVolume * 100)}% </span>
            </label>
            <input
              id="settings-audio-bgm"
              type="range"
              min="0"
              max="100"
              value={Math.round(viewModel.bgmVolume * 100)}
              class="range"
              oninput={(e) => {
                viewModel.setBgmVolume(Number(e.currentTarget.value) / 100);
              }}
            >
          </div>

          <!-- SFX Volume -->
          <div class="form-control">
            <label class="label" for="settings-audio-sfx">
              <span class="label-text">Sound Effects</span>
              <span class="label-text-alt"> {Math.round(viewModel.sfxVolume * 100)}% </span>
            </label>
            <input
              id="settings-audio-sfx"
              type="range"
              min="0"
              max="100"
              value={Math.round(viewModel.sfxVolume * 100)}
              class="range"
              oninput={(e) => {
                viewModel.setSfxVolume(Number(e.currentTarget.value) / 100);
              }}
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Test Playback card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">🎵 Test Playback</h2>
        <p class="text-base-content/60 text-sm">Verify your volume settings with test audio.</p>

        <!-- BGM test buttons -->
        <div class="flex gap-3 mt-2">
          <button class="btn btn-primary flex-1" onclick={() => viewModel.testExploreBgm()}>
            🌲 Explore BGM
          </button>
          <button class="btn btn-error flex-1" onclick={() => viewModel.testCombatBgm()}>
            ⚔️ Combat BGM
          </button>
        </div>

        <!-- SFX test button -->
        <div class="flex gap-3 mt-3">
          <button class="btn btn-warning flex-1" onclick={() => viewModel.testHitSfx()}>
            🔨 Test SFX
          </button>
          <button class="btn btn-outline btn-sm" onclick={() => viewModel.stopAll()}>
            ⏹ Stop All
          </button>
        </div>

        <!-- Status feedback -->
        {#if viewModel.feedback}
          <div
            class="mt-4 py-2 px-3 bg-base-200 rounded-lg text-sm font-mono"
            class:text-success={viewModel.feedback.includes('Playing')}
          >
            {viewModel.feedback}
          </div>
        {/if}

        <!-- Crossfade indicator -->
        {#if viewModel.isCrossfading}
          <span class="badge badge-warning gap-1 mt-2">
            <span class="loading loading-spinner loading-xs"></span>
            Crossfading…
          </span>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
