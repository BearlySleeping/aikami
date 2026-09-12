<script lang="ts">
// apps/frontend/hub/src/lib/views/map_studio/map_studio_view.svelte
// Map studio view — manifest input on the left, live engine preview on the right.

import { BaseViewModelContainer } from '$components';
import type { HubMapStudioViewModelInterface } from './map_studio_view_model.svelte.ts';

type Props = { viewModel: HubMapStudioViewModelInterface };
let { viewModel }: Props = $props();

const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 576;

// The View is logicless: `BaseViewModelContainer` owns initialize/dispose, and
// the canvas is bound straight onto the ViewModel, which reacts to it
// internally. No `onMount`, no `$effect` here.
let selectedTag = $state<string>('');

// ── Handlers ──────────────────────────────────────────────────────────────

const onManifestInput = (event: Event) => {
  const target = event.currentTarget as HTMLTextAreaElement;
  viewModel.setManifestText(target.value);
};

const onFileChange = async (event: Event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await viewModel.loadManifestFile(file);
  }
  input.value = '';
};

const onLoadPublished = async () => {
  if (selectedTag) {
    await viewModel.loadPublishedMap(selectedTag);
  }
};

const lineCount = $derived(viewModel.manifestText.split('\n').length);
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">Map Studio</h1>
      <p class="text-sm text-base-content/70">
        Paste or upload a map manifest — native <code>aikami.scene</code>, Tiled JSON or JTON. It
        renders through the same scene loader the game uses, against published catalog assets.
      </p>
    </header>

    {#if viewModel.studioError}
      <div class="alert alert-error text-sm" role="alert">
        {viewModel.studioError}
      </div>
    {/if}

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <!-- ── Input panel ─────────────────────────────────────────────── -->
      <section class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick={() => viewModel.resetToSample()}
          >
            Sample map
          </button>
          <button type="button" class="btn btn-sm" onclick={() => viewModel.formatManifest()}>
            Format JSON
          </button>

          <label class="btn btn-sm">
            Upload file
            <input
              type="file"
              class="hidden"
              accept=".json,.jton,application/json"
              onchange={onFileChange}
            >
          </label>

          <div class="join">
            <select class="select select-sm join-item max-w-52" bind:value={selectedTag}>
              <option value="">Published map…</option>
              {#each viewModel.publishedMaps as map (map.tag)}
                <option value={map.tag}>{map.label}</option>
              {/each}
            </select>
            <button
              type="button"
              class="btn btn-sm join-item"
              disabled={!selectedTag || viewModel.loadingMapTag !== undefined}
              onclick={onLoadPublished}
            >
              {#if viewModel.loadingMapTag}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                Load
              {/if}
            </button>
          </div>
        </div>

        <textarea
          class="textarea textarea-bordered w-full font-mono text-xs leading-5 h-[28rem] resize-y"
          spellcheck="false"
          aria-label="Map manifest JSON"
          value={viewModel.manifestText}
          oninput={onManifestInput}
        ></textarea>

        <p class="text-xs text-base-content/60">
          {lineCount}
          lines · {viewModel.manifestText.length} characters
        </p>
      </section>

      <!-- ── Preview panel ───────────────────────────────────────────── -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Preview</h2>
          {#if viewModel.previewReady}
            <span class="badge badge-sm badge-success">live</span>
          {:else}
            <span class="badge badge-sm">idle</span>
          {/if}
        </div>

        {#if viewModel.previewError}
          <div class="alert alert-warning text-xs" role="alert">
            {viewModel.previewError}
          </div>
        {/if}

        <div class="rounded-box border border-base-300 bg-base-300 p-2 overflow-auto">
          <canvas
            bind:this={viewModel.canvasElement}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            class="block [image-rendering:pixelated]"
            aria-label="Map preview"
          ></canvas>
        </div>

        <p class="text-xs text-base-content/60">
          Rendered with the game's scene loader against the published catalog — no local files.
        </p>
      </section>
    </div>
  </div>
</BaseViewModelContainer>
