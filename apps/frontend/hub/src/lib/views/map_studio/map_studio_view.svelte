<script lang="ts">
// apps/frontend/hub/src/lib/views/map_studio/map_studio_view.svelte
// Map studio view — manifest input on the left, live engine preview on the right.
// C-507 adds the visual-editing toolbar; every action delegates to the ViewModel.

import { BaseViewModelContainer } from '$components';
import type { EditorToolKind } from './map_editor_utils.ts';
import type { HubMapStudioViewModelInterface } from './map_studio_view_model.svelte.ts';

type Props = { viewModel: HubMapStudioViewModelInterface };
let { viewModel }: Props = $props();

// The View is logicless: `BaseViewModelContainer` owns initialize/dispose, and
// the canvas is bound straight onto the ViewModel, which reacts to it
// internally. No `onMount`, no `$effect` here.
let selectedTag = $state<string>('');

type ToolButton = { kind: EditorToolKind; label: string; testId: string };

const TOOL_BUTTONS: readonly ToolButton[] = [
  { kind: 'select', label: 'Select', testId: 'tool-select' },
  { kind: 'paint', label: 'Paint ground', testId: 'tool-paint' },
  { kind: 'erase', label: 'Erase', testId: 'tool-erase' },
  { kind: 'collide-block', label: 'Block', testId: 'tool-collide-block' },
  { kind: 'collide-unblock', label: 'Unblock', testId: 'tool-collide-unblock' },
  { kind: 'place', label: 'Place', testId: 'tool-place' },
  { kind: 'transition', label: 'Transition', testId: 'tool-transition' },
  { kind: 'delete', label: 'Delete', testId: 'tool-delete' },
];

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

const onCanvasPointer = (event: PointerEvent) => {
  viewModel.handleCanvasPointer(event);
};

const onCanvasKeydown = (event: KeyboardEvent) => {
  viewModel.handleCanvasKeydown(event);
};

const onPaintFrameChange = (event: Event) => {
  viewModel.setPaintFrame((event.currentTarget as HTMLSelectElement).value);
};

const onPlaceFrameChange = (event: Event) => {
  viewModel.setPlaceFrame((event.currentTarget as HTMLSelectElement).value);
};

const onPlaceComponentInput = (event: Event) => {
  viewModel.setPlaceComponent((event.currentTarget as HTMLInputElement).value);
};

const onTransitionTargetInput = (event: Event) => {
  viewModel.setTransitionTargetMap((event.currentTarget as HTMLInputElement).value);
};

const onDraftNameInput = (event: Event) => {
  viewModel.setDraftName((event.currentTarget as HTMLInputElement).value);
};

const onPublishTitleInput = (event: Event) => {
  viewModel.setPublishTitle((event.currentTarget as HTMLInputElement).value);
};

let selectedDraftId = $state<string>('');

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
            disabled={viewModel.editing}
            onclick={() => viewModel.resetToSample()}
          >
            Sample map
          </button>
          <button
            type="button"
            class="btn btn-sm"
            disabled={viewModel.editing}
            onclick={() => viewModel.formatManifest()}
          >
            Format JSON
          </button>

          <label class="btn btn-sm" class:opacity-50={viewModel.editing}>
            Upload file
            <input
              type="file"
              class="hidden"
              disabled={viewModel.editing}
              accept=".json,.jton,application/scene+json,application/json"
              onchange={onFileChange}
            >
          </label>

          <div class="join">
            <select
              class="select select-sm join-item max-w-52"
              disabled={viewModel.editing}
              bind:value={selectedTag}
            >
              <option value="">Published map…</option>
              {#each viewModel.publishedMaps as map (map.tag)}
                <option value={map.tag}>{map.label}</option>
              {/each}
            </select>
            <button
              type="button"
              class="btn btn-sm join-item"
              disabled={viewModel.editing || !selectedTag || viewModel.loadingMapTag !== undefined}
              onclick={onLoadPublished}
            >
              {#if viewModel.loadingMapTag}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                Load
              {/if}
            </button>
          </div>

          <button
            type="button"
            class="btn btn-sm"
            class:btn-active={viewModel.editing}
            data-testid="toggle-edit"
            onclick={() => viewModel.toggleEditing()}
          >
            {viewModel.editing ? 'Stop editing' : 'Edit scene'}
          </button>
        </div>

        {#if viewModel.editorReady}
          <!-- ── Editor toolbar ──────────────────────────────────────── -->
          <div class="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              {#each TOOL_BUTTONS as tool (tool.kind)}
                <button
                  type="button"
                  class="btn btn-xs"
                  class:btn-active={viewModel.tool === tool.kind}
                  aria-pressed={viewModel.tool === tool.kind}
                  data-testid={tool.testId}
                  onclick={() => viewModel.setTool(tool.kind)}
                >
                  {tool.label}
                </button>
              {/each}
              <span class="mx-1 h-4 border-l border-base-300"></span>
              <button
                type="button"
                class="btn btn-xs"
                disabled={!viewModel.canUndo}
                data-testid="undo"
                onclick={() => viewModel.undo()}
              >
                Undo
              </button>
              <button
                type="button"
                class="btn btn-xs"
                disabled={!viewModel.canRedo}
                data-testid="redo"
                onclick={() => viewModel.redo()}
              >
                Redo
              </button>
              <button
                type="button"
                class="btn btn-xs btn-primary"
                disabled={!viewModel.exportable}
                data-testid="export"
                onclick={() => viewModel.exportScene()}
              >
                Export .scene.json
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-3 text-xs">
              {#if viewModel.groundFrames.length > 0}
                <label class="flex items-center gap-1">
                  <span>Ground</span>
                  <select
                    class="select select-xs"
                    value={viewModel.paintFrame}
                    onchange={onPaintFrameChange}
                  >
                    <option value="">— none —</option>
                    {#each viewModel.groundFrames as frame (frame)}
                      <option value={frame}>{frame}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if viewModel.terrainIds.length > 0}
                <label class="flex items-center gap-1">
                  <span>Terrain</span>
                  <select
                    class="select select-xs"
                    value={viewModel.paintFrame}
                    onchange={onPaintFrameChange}
                  >
                    {#each viewModel.terrainIds as id (id)}
                      <option value={id}>{id}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              <label class="flex items-center gap-1">
                <span>Prop frame</span>
                <input
                  class="input input-xs w-36"
                  type="text"
                  value={viewModel.placeFrame}
                  oninput={onPlaceFrameChange}
                >
              </label>
              <label class="flex items-center gap-1">
                <span>Component</span>
                <input
                  class="input input-xs w-24"
                  type="text"
                  value={viewModel.placeComponent}
                  oninput={onPlaceComponentInput}
                >
              </label>
              <label class="flex items-center gap-1">
                <span>Transition →</span>
                <input
                  class="input input-xs w-28"
                  type="text"
                  placeholder="map id"
                  value={viewModel.transitionTargetMap}
                  oninput={onTransitionTargetInput}
                >
              </label>
            </div>

            <p class="text-xs text-base-content/60">
              {viewModel.sceneExtentLabel}
              ·
              {#if viewModel.selection}
                selected {viewModel.selection.kind} {viewModel.selection.id}
              {:else}
                no selection
              {/if}
              · click the preview to apply the active tool
            </p>
          </div>
        {/if}

        {#if viewModel.editorError}
          <div class="alert alert-warning text-xs" role="alert">
            {viewModel.editorError}
          </div>
        {/if}

        <textarea
          class="textarea textarea-bordered w-full font-mono text-xs leading-5 h-[28rem] resize-y"
          spellcheck="false"
          aria-label="Map manifest JSON"
          readonly={viewModel.editing}
          value={viewModel.manifestText}
          oninput={onManifestInput}
        ></textarea>

        <p class="text-xs text-base-content/60">
          {lineCount}
          lines · {viewModel.manifestText.length} characters
        </p>

        <!-- ── Drafts & community publishing (C-508) ───────────────── -->
        <div class="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-2">
          <h3 class="text-sm font-semibold">Drafts &amp; publish</h3>
          <div class="flex flex-wrap items-center gap-2">
            <input
              class="input input-xs w-40"
              type="text"
              placeholder="Draft name"
              value={viewModel.draftName}
              oninput={onDraftNameInput}
            >
            <button
              type="button"
              class="btn btn-xs"
              disabled={viewModel.draftsBusy}
              onclick={() => viewModel.saveDraft()}
            >
              {viewModel.selectedDraftId ? 'Update draft' : 'Save draft'}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              disabled={viewModel.draftsBusy}
              onclick={() => viewModel.refreshDrafts()}
            >
              Refresh
            </button>
          </div>
          {#if viewModel.drafts.length > 0}
            <div class="flex flex-wrap items-center gap-2">
              <select class="select select-xs max-w-52" bind:value={selectedDraftId}>
                <option value="">My drafts…</option>
                {#each viewModel.drafts as draft (draft.id)}
                  <option value={draft.id}>{draft.name}</option>
                {/each}
              </select>
              <button
                type="button"
                class="btn btn-xs"
                disabled={!selectedDraftId || viewModel.draftsBusy}
                onclick={() => selectedDraftId && viewModel.loadDraft(selectedDraftId)}
              >
                Load
              </button>
              <button
                type="button"
                class="btn btn-xs btn-outline btn-error"
                disabled={!selectedDraftId || viewModel.draftsBusy}
                onclick={() => selectedDraftId && viewModel.deleteDraft(selectedDraftId)}
              >
                Delete
              </button>
            </div>
          {:else}
            <p class="text-xs text-base-content/60">No saved drafts (sign in to save).</p>
          {/if}
          <div class="divider my-0"></div>
          <div class="flex flex-wrap items-center gap-2">
            <input
              class="input input-xs w-48"
              type="text"
              placeholder="Publish title"
              value={viewModel.publishTitle}
              oninput={onPublishTitleInput}
            >
            <button
              type="button"
              class="btn btn-xs btn-primary"
              disabled={viewModel.publishing}
              onclick={() => viewModel.publishScene()}
            >
              {viewModel.publishing ? 'Publishing…' : 'Publish community map'}
            </button>
          </div>
          {#if viewModel.publishStatus}
            <p class="text-xs text-success">{viewModel.publishStatus}</p>
          {/if}
        </div>
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

        <div class="rounded-box border border-base-300 bg-base-300 p-2 overflow-auto max-h-[40rem]">
          <canvas
            bind:this={viewModel.canvasElement}
            width={viewModel.canvasWidth}
            height={viewModel.canvasHeight}
            class="block [image-rendering:pixelated]"
            class:cursor-crosshair={viewModel.editing}
            aria-label="Map preview"
            tabindex="0"
            onpointerdown={onCanvasPointer}
            onkeydown={onCanvasKeydown}
          ></canvas>
        </div>

        <p class="text-xs text-base-content/60">
          {#if viewModel.editing}
            Editing — the preview re-renders through the game's scene loader. Export writes native
            <code>aikami.scene</code>.
          {:else}
            Rendered with the game's scene loader against the published catalog — no local files.
          {/if}
        </p>
      </section>
    </div>
  </div>
</BaseViewModelContainer>
