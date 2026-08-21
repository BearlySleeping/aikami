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
          <!-- Music Player overlay toggle -->
          <div class="form-control">
            <label class="label cursor-pointer" for="settings-audio-music-player">
              <span class="label-text flex items-center gap-2">
                🎵 In-Game Music Player
                <span class="badge badge-outline badge-xs">overlay</span>
              </span>
              <input
                id="settings-audio-music-player"
                type="checkbox"
                class="toggle toggle-primary"
                checked={viewModel.musicPlayerVisible}
                onchange={() => viewModel.toggleMusicPlayer()}
              >
            </label>
            <p class="label-text-alt text-base-content/50 px-1">
              Show a mini music player in-game with skip / pause / stop and vibe-matched song
              suggestions.
            </p>
          </div>

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

          <!-- TTS Volume -->
          <div class="form-control">
            <label class="label" for="settings-audio-tts">
              <span class="label-text">Speech (TTS)</span>
              <span class="label-text-alt"> {Math.round(viewModel.ttsVolume * 100)}% </span>
            </label>
            <input
              id="settings-audio-tts"
              type="range"
              min="0"
              max="100"
              value={Math.round(viewModel.ttsVolume * 100)}
              class="range"
              oninput={(e) => {
                viewModel.setTtsVolume(Number(e.currentTarget.value) / 100);
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
          <button
            type="button"
            class="btn btn-primary flex-1"
            onclick={() => viewModel.testExploreBgm()}
          >
            🌲 Explore BGM
          </button>
          <button
            type="button"
            class="btn btn-error flex-1"
            onclick={() => viewModel.testCombatBgm()}
          >
            ⚔️ Combat BGM
          </button>
        </div>

        <!-- SFX test button -->
        <div class="flex gap-3 mt-3">
          <button
            type="button"
            class="btn btn-warning flex-1"
            onclick={() => viewModel.testHitSfx()}
          >
            🔨 Test SFX
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick={() => viewModel.stopAll()}>
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
    <!-- Voice Model card (C-389 AC-4c) -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">🗣️ Speech (Voice Model)</h2>
        <p class="text-base-content/60 text-sm">
          Browser TTS runs fully offline once the Kokoro voice model is downloaded. The download is
          explicit — nothing is fetched until you press the button.
        </p>

        <div class="divider"></div>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content/70">Backend</span>
            <span class="badge badge-outline font-mono text-xs">{viewModel.ttsBackendLabel}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content/70">Status</span>
            <span class="badge badge-outline font-mono text-xs">{viewModel.ttsStatusLabel}</span>
          </div>

          {#if viewModel.voiceModelState.status === 'not-downloaded'}
            <div class="alert alert-info py-2 text-sm">
              <span>
                The voice model is not downloaded yet. Size:
                <strong>{viewModel.voiceModelSizeLabel}</strong>.
              </span>
            </div>
            <button
              type="button"
              class="btn btn-primary w-full"
              onclick={() => viewModel.downloadVoiceModel()}
            >
              ⬇ Download voice model ({viewModel.voiceModelSizeLabel})
            </button>
          {:else if viewModel.voiceModelState.status === 'downloading'}
            <div class="w-full">
              <progress
                class="progress progress-primary w-full"
                value={viewModel.voiceModelProgress}
                max="100"
              ></progress>
              <p class="text-xs text-base-content/60 mt-1 font-mono">
                Downloading… {viewModel.voiceModelProgress}%
              </p>
            </div>
            <button
              type="button"
              class="btn btn-outline btn-error w-full"
              onclick={() => viewModel.cancelVoiceModelDownload()}
            >
              ⏹ Cancel download
            </button>
          {:else if viewModel.voiceModelState.status === 'verifying'}
            <div class="flex items-center gap-2 text-sm">
              <span class="loading loading-spinner loading-sm"></span>
              Verifying checksum…
            </div>
          {:else if viewModel.voiceModelState.status === 'error'}
            <div class="alert alert-error py-2 text-sm">
              <span>{viewModel.voiceModelState.message}</span>
            </div>
            <button
              type="button"
              class="btn btn-primary w-full"
              onclick={() => viewModel.downloadVoiceModel()}
            >
              ⬇ Retry download
            </button>
          {:else if viewModel.voiceModelState.status === 'ready'}
            <div class="alert alert-success py-2 text-sm">
              <span>✓ Voice model ready — speech works offline.</span>
            </div>
            <div class="flex gap-2">
              {#if viewModel.isTtsPlaying}
                <button
                  type="button"
                  class="btn btn-outline btn-error flex-1"
                  onclick={() => viewModel.stopTts()}
                >
                  ⏹ Stop TTS
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn-primary flex-1"
                  onclick={() => viewModel.testTts()}
                >
                  🔊 Test TTS
                </button>
                <button
                  type="button"
                  class="btn btn-outline btn-error"
                  onclick={() => viewModel.deleteVoiceModel()}
                >
                  🗑 Delete
                </button>
              {/if}
            </div>
          {/if}

          <p class="label-text-alt text-base-content/50 px-1">
            Without WebGPU the WASM backend is used and speech will be slower. The model download is
            resumable and verifies a checksum before use.
          </p>

          {#if viewModel.feedback && viewModel.voiceModelState.status === 'ready'}
            <p class="text-sm font-mono text-base-content/70">{viewModel.feedback}</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
