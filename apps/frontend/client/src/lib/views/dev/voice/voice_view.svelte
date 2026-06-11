<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/voice/voice_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { VoiceViewModelInterface } from './voice_view_model.svelte.ts';

  type Props = {
    viewModel: VoiceViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

<svelte:head>
  <title>Voice Generation - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-8 gap-6">
    <div class="w-full max-w-2xl">
      <h1 class="mb-2 text-2xl font-bold">Voice Generation</h1>
      <p class="mb-6 text-base-content/60">
        Test and debug voice synthesis and speech-to-text pipelines.
      </p>

      <!-- Voice selector -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-4">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-semibold">Voice</span>
              {#if viewModel.voices.length === 0}
                <span class="label-text-alt text-base-content/40">Loading voices...</span>
              {:else}
                <span class="label-text-alt text-base-content/40"
                  >{viewModel.voices.length}
                  voices available</span
                >
              {/if}
            </div>
            <select
              class="select select-bordered w-full"
              bind:value={viewModel.selectedVoice}
              disabled={viewModel.isPlaying || viewModel.voices.length === 0}
            >
              {#each viewModel.voices as voice}
                <option value={voice.id}>{voice.id} — {voice.description}</option>
              {/each}
            </select>
          </label>
        </div>
      </div>

      <!-- Script input -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-6">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-semibold">Script</span>
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-32 font-mono text-sm"
              placeholder="Enter the text to synthesize into speech..."
              bind:value={viewModel.text}
              disabled={viewModel.isPlaying}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  void viewModel.generateAndPlay();
                }
              }}
            ></textarea>
            <div class="label">
              <span class="label-text-alt text-base-content/40">Ctrl+Enter to generate</span>
            </div>
          </label>

          <div class="flex gap-3 mt-2">
            {#if viewModel.isPlaying}
              <button class="btn btn-ghost" onclick={() => viewModel.cancel()}>⏹ Cancel</button>
            {:else}
              <button
                class="btn btn-primary"
                onclick={() => viewModel.generateAndPlay()}
                disabled={!viewModel.text.trim()}
              >
                ▶ Generate Audio
              </button>
            {/if}
          </div>
        </div>
      </div>

      <!-- Audio queue status -->
      <div class="card bg-base-300 shadow">
        <div class="card-body p-6">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wider"
              >Audio Queue</span
            >
            {#if viewModel.isConnected}
              <span class="badge badge-success gap-1">
                <span class="w-2 h-2 rounded-full bg-white"></span>
                Connected
              </span>
            {:else if viewModel.isPlaying}
              <span class="loading loading-dots loading-xs text-primary"></span>
            {/if}
          </div>

          <div class="flex flex-col gap-3">
            <!-- Status indicator -->
            <div class="flex items-center gap-3">
              <div
                class="w-3 h-3 rounded-full {viewModel.isPlaying ? 'bg-success' : 'bg-base-content/20'}"
              ></div>
              <span class="text-sm">
                {#if viewModel.isPlaying}
                  Playing...
                {:else}
                  Idle
                {/if}
              </span>
            </div>

            <!-- Progress bar -->
            <progress
              class="progress progress-primary w-full"
              value={viewModel.isPlaying ? 100 : 0}
              max="100"
            ></progress>
          </div>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
