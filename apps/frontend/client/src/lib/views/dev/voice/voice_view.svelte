<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/voice/voice_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { VoiceViewModelInterface } from './voice_view_model.svelte.ts';
  import { OUTPUT_FORMATS } from './voice_view_model.svelte.ts';

  type Props = {
    viewModel: VoiceViewModelInterface;
  };

  let { viewModel }: Props = $props();

  /** The active voice list: server-fetched if available, fallback otherwise. */
  const displayVoices = $derived(
    viewModel.voices.length > 0 ? viewModel.voices : viewModel.fallbackVoices,
  );

  /** Show progress only during active synthesis/playback. */
  const showProgress = $derived(viewModel.isConnected || viewModel.isPlaying);
  /** Synthesis download % during fetch, word playback % during audio. */
  const progressPercent = $derived(
    viewModel.isPlaying ? viewModel.playbackProgress : viewModel.synthesisProgress,
  );
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

      <!-- Config options -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-4">
          <h2
            class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
          >
            Configuration
          </h2>

          <div class="grid grid-cols-2 gap-3">
            <!-- Engine -->
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">Engine</span>
              </div>
              <select
                class="select select-bordered select-sm w-full"
                bind:value={viewModel.engine}
                disabled={viewModel.isPlaying || viewModel.isConnected}
              >
                {#each viewModel.voiceEngines as eng}
                  <option value={eng.id}>{eng.label}</option>
                {/each}
              </select>
            </label>

            <!-- Voice -->
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">Voice</span>
              </div>
              <select
                class="select select-bordered select-sm w-full"
                bind:value={viewModel.selectedVoice}
                disabled={viewModel.isPlaying || viewModel.isConnected}
              >
                {#each displayVoices as voice}
                  <option value={voice.id}>{voice.id} — {voice.description}</option>
                {/each}
              </select>
            </label>

            <!-- Format -->
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">Format</span>
              </div>
              <select
                class="select select-bordered select-sm w-full"
                bind:value={viewModel.responseFormat}
                disabled={viewModel.isPlaying || viewModel.isConnected}
              >
                {#each OUTPUT_FORMATS as fmt}
                  <option value={fmt.id}>{fmt.label}</option>
                {/each}
              </select>
            </label>

            <!-- Stream toggle -->
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">Streaming</span>
              </div>
              <div class="flex items-center h-8">
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-primary"
                  bind:checked={viewModel.streamEnabled}
                  disabled={viewModel.isPlaying || viewModel.isConnected}
                >
                <span class="ml-2 text-xs text-base-content/50"> Chunked (progressive) </span>
              </div>
            </label>

            <!-- Speed -->
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold"
                  >Speed ({viewModel.speed.toFixed(1)})</span
                >
              </div>
              <input
                type="range"
                min="0.25"
                max="4.0"
                step="0.05"
                class="range range-xs range-primary"
                bind:value={viewModel.speed}
                disabled={viewModel.isPlaying || viewModel.isConnected}
              >
            </label>

            <!-- Volume -->
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold"
                  >Volume ({viewModel.volumeMultiplier.toFixed(1)})</span
                >
              </div>
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.1"
                class="range range-xs range-secondary"
                bind:value={viewModel.volumeMultiplier}
                disabled={viewModel.isPlaying || viewModel.isConnected}
              >
            </label>
          </div>
        </div>
      </div>

      <!-- Script input -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-6">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-semibold">Script</span>
              <span class="label-text-alt text-base-content/40"
                >{viewModel.text.length}
                chars</span
              >
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-32 font-mono text-sm"
              placeholder="Enter the text to synthesize into speech..."
              bind:value={viewModel.text}
              disabled={viewModel.isPlaying || viewModel.isConnected}
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
            {#if viewModel.isPlaying || viewModel.isConnected}
              <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancel()}>
                ⏹ Cancel
              </button>
            {:else}
              <button
                type="button"
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

      <!-- Progress & Status -->
      <div class="card bg-base-300 shadow">
        <div class="card-body p-6">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
              Audio Queue
            </span>

            {#if viewModel.isConnected}
              <span class="badge badge-warning gap-1">
                <span class="loading loading-spinner loading-xs"></span>
                Synthesizing
              </span>
            {:else if viewModel.isPlaying}
              <span class="badge badge-success gap-1">
                <span class="w-2 h-2 rounded-full bg-white"></span>
                Playing
              </span>
            {:else}
              <span class="badge badge-ghost gap-1 text-base-content/40">Idle</span>
            {/if}
          </div>

          <div class="flex flex-col gap-3">
            <!-- Progress indicator -->
            <div class="flex items-center gap-3">
              <div
                class="w-3 h-3 rounded-full {viewModel.isPlaying
                  ? 'bg-success animate-pulse'
                  : viewModel.isConnected
                    ? 'bg-warning animate-pulse'
                    : 'bg-base-content/20'}"
              ></div>
              <span class="text-sm">
                {#if viewModel.isConnected}
                  {#if progressPercent > 0}
                    Synthesizing {progressPercent}%
                  {:else}
                    Connecting...
                  {/if}
                {:else if viewModel.isPlaying}
                  Playing...
                {:else}
                  Ready
                {/if}
              </span>
              {#if showProgress && progressPercent > 0}
                <span class="ml-auto text-xs text-base-content/50 font-mono"
                  >{progressPercent}%</span
                >
              {/if}
            </div>

            <!-- Progress bar -->
            <progress
              class="progress {viewModel.isConnected ? 'progress-warning' : 'progress-success'} w-full"
              value={progressPercent}
              max="100"
            ></progress>

            <!-- Detail row -->
            <div class="flex gap-4 text-xs text-base-content/40 font-mono">
              <span>Engine: {viewModel.engine}</span>
              <span>Format: {viewModel.responseFormat}</span>
              <span>Speed: {viewModel.speed.toFixed(1)}x</span>
              <span>Voice: {viewModel.selectedVoice}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
