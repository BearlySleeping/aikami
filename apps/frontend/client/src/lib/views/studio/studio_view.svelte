<script lang="ts">
// apps/frontend/client/src/lib/views/studio/studio_view.svelte
//
// C-512: Creator Studio. Logicless — every expression is a direct ViewModel
// property access and every handler is an arrow wrapper.
import { BaseViewModelContainer, Image } from '$components';
import type { StudioViewModelInterface } from './studio_view_model.svelte';

type Props = { viewModel: StudioViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">Creator Studio</h1>
      <p class="text-sm text-base-content/60">
        Generate an asset with your local engine, review it, and save it into your library. Saved
        assets resolve in-game through their tag.
      </p>
    </header>

    {#if !viewModel.generationEnabled}
      <div role="status" class="alert alert-warning text-sm">
        Asset generation is disabled (PUBLIC_ASSET_GENERATION is off). Generating and saving are
        unavailable.
      </div>
    {/if}

    <section class="card bg-base-200 shadow">
      <div class="card-body gap-4 p-4">
        <div class="form-control">
          <label class="label py-0.5" for="studio-recipe">
            <span class="label-text text-xs font-semibold">Asset type</span>
          </label>
          <select
            id="studio-recipe"
            class="select select-bordered select-sm w-full"
            value={viewModel.selectedRecipeId}
            onchange={(event) => viewModel.selectRecipe((event.target as HTMLSelectElement).value)}
          >
            {#each viewModel.recipes as recipe (recipe.recipeId)}
              <option value={recipe.recipeId} disabled={!recipe.engineAvailable}>
                {recipe.label}
              </option>
            {/each}
          </select>
        </div>

        {#if viewModel.isNpcBound}
          <div class="form-control">
            <label class="label py-0.5" for="studio-npc">
              <span class="label-text text-xs font-semibold">NPC id</span>
            </label>
            <input
              id="studio-npc"
              class="input input-bordered input-sm w-full"
              type="text"
              placeholder="merchant"
              value={viewModel.npcId}
              oninput={(event) => viewModel.setNpcId((event.target as HTMLInputElement).value)}
            >
            <span class="mt-1 text-[10px] font-mono text-base-content/50">
              Saved as portraits:&lt;npc&gt;-neutral so the dialogue avatar resolver finds it.
            </span>
          </div>
        {/if}

        <div class="form-control">
          <label class="label py-0.5" for="studio-prompt">
            <span class="label-text text-xs font-semibold">Prompt</span>
          </label>
          <textarea
            id="studio-prompt"
            class="textarea textarea-bordered w-full"
            rows="3"
            value={viewModel.positivePrompt}
            oninput={(event) =>
              viewModel.setPositivePrompt((event.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div class="form-control">
          <label class="label py-0.5" for="studio-negative">
            <span class="label-text text-xs font-semibold">Negative prompt (optional)</span>
          </label>
          <input
            id="studio-negative"
            class="input input-bordered input-sm w-full"
            type="text"
            value={viewModel.negativePrompt}
            oninput={(event) =>
              viewModel.setNegativePrompt((event.target as HTMLInputElement).value)}
          >
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!viewModel.canGenerate || viewModel.isGenerating || viewModel.isGeneratingPack}
            onclick={() => viewModel.generate()}
          >
            Generate
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={!viewModel.isGenerating}
            onclick={() => viewModel.cancel()}
          >
            Cancel
          </button>
          <span class="text-xs text-base-content/60">{viewModel.generationStatus}</span>
        </div>

        {#if !viewModel.canGenerate}
          <p class="text-xs text-warning" role="status">{viewModel.generateDisabledReason}</p>
        {/if}

        {#if viewModel.hasGenerated}
          <div class="flex flex-col gap-3 rounded border border-base-300 p-3">
            <div class="flex flex-wrap gap-3 text-[10px] font-mono text-base-content/70">
              <span>Tag: {viewModel.pendingTag}</span>
              <span>Ext: {viewModel.generatedExt}</span>
              <span>Engine: {viewModel.generatedEngine}</span>
              <span>Seed: {viewModel.generatedSeedLabel}</span>
            </div>
            <Image
              src={viewModel.previewUrl}
              alt="Generated asset preview"
              class="max-h-64 w-auto rounded"
            />
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={viewModel.isSaving}
                onclick={() => viewModel.save()}
              >
                Save to library
              </button>
            </div>
          </div>
        {/if}

        <!-- The save outcome lives outside the review block: a successful save
             clears `generated` in the same tick, so a message rendered inside it
             would never be seen. -->
        {#if viewModel.saveMessage}
          <p class="text-xs text-success" role="status">{viewModel.saveMessage}</p>
        {/if}

        {#if viewModel.errorMessage}
          <p class="text-xs text-error" role="alert">{viewModel.errorMessage}</p>
        {/if}
      </div>
    </section>

    {#if viewModel.isNpcBound}
      <section class="card bg-base-200 shadow">
        <div class="card-body gap-3 p-4">
          <h2 class="text-lg font-semibold">Expression pack</h2>
          <p class="text-xs text-base-content/60">
            Registers one portrait per emotion under the tag the dialogue avatar resolver looks up.
            Load a reference face first so the set stays consistent.
          </p>

          <div class="flex flex-wrap items-center gap-3">
            <label class="label py-0.5" for="studio-reference">
              <span class="label-text text-xs font-semibold">Reference face</span>
            </label>
            <input
              id="studio-reference"
              type="file"
              accept="image/*"
              class="file-input file-input-bordered file-input-xs"
              onchange={(event) =>
                viewModel.setReferenceImageFile((event.target as HTMLInputElement).files?.[0])}
            >
            {#if viewModel.hasReferenceImage}
              <span class="text-[10px] font-mono text-base-content/60">
                {viewModel.referenceImageName}
              </span>
              <Image
                src={viewModel.referenceImagePreviewUrl}
                alt="Reference face preview"
                class="h-12 w-12 rounded object-cover"
              />
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => viewModel.clearReferenceImage()}
              >
                Clear
              </button>
            {/if}
          </div>

          <ul class="flex flex-col gap-1">
            {#each viewModel.packRows as row (row.emotion)}
              <li class="flex items-center gap-3 text-xs">
                <span class="w-20 text-base-content/70">{row.emotion}</span>
                <span class="font-mono text-[10px] text-base-content/50">{row.tag}</span>
                <span class="ml-auto text-[10px] text-base-content/60">{row.status}</span>
              </li>
            {/each}
          </ul>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={!viewModel.canGenerate || viewModel.isGenerating || viewModel.isGeneratingPack}
              onclick={() => viewModel.generatePack()}
            >
              Generate pack
            </button>
            <span class="text-xs text-base-content/60">{viewModel.packMessage}</span>
          </div>
        </div>
      </section>
    {/if}

    <section class="card bg-base-200 shadow">
      <div class="card-body gap-3 p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">My library</h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            onclick={() => viewModel.refreshLibrary()}
          >
            Refresh
          </button>
        </div>

        {#if viewModel.isLibraryLoading}
          <p class="text-xs text-base-content/60">Loading…</p>
        {:else if viewModel.libraryRows.length === 0}
          <p class="text-xs text-base-content/60">
            Nothing generated yet. Assets you save appear here and are protected from cache
            eviction.
          </p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each viewModel.libraryRows as row (row.tag)}
              <li
                class="flex flex-wrap items-center gap-3 rounded border border-base-300 px-3 py-2"
              >
                <span class="font-mono text-xs">{row.tag}</span>
                <span class="badge badge-ghost text-[10px] font-mono">{row.category}</span>
                <span class="badge badge-ghost text-[10px] font-mono">{row.provenanceLabel}</span>
                <span class="text-[10px] font-mono text-base-content/60">{row.sizeLabel}</span>
                <span class="text-[10px] font-mono text-base-content/60">{row.ext}</span>
                <span class="text-[10px] font-mono text-base-content/40">
                  {row.createdAtLabel}
                </span>
                <span class="ml-auto flex gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    onclick={() => viewModel.beginRename(row.tag)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    class="btn btn-error btn-xs btn-outline"
                    onclick={() => viewModel.beginDelete(row.tag)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if viewModel.hasRenameTarget}
          <div class="flex flex-wrap items-center gap-3 rounded border border-base-300 p-3">
            <label class="label py-0.5" for="studio-rename">
              <span class="label-text text-xs font-semibold">New tag</span>
            </label>
            <input
              id="studio-rename"
              class="input input-bordered input-sm font-mono text-xs"
              type="text"
              value={viewModel.renameValue}
              oninput={(event) => viewModel.setRenameValue((event.target as HTMLInputElement).value)}
            >
            <button
              type="button"
              class="btn btn-primary btn-xs"
              onclick={() => viewModel.confirmRename()}
            >
              Rename
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={() => viewModel.cancelRename()}
            >
              Cancel
            </button>
          </div>
        {/if}

        {#if viewModel.hasDeleteTarget}
          <div class="flex flex-col gap-2 rounded border border-error/40 p-3">
            <p class="text-xs">
              Delete {viewModel.deleteTargetTag}? Its cached bytes are removed too.
            </p>
            {#if viewModel.hasDeleteReferences}
              <p class="text-xs text-warning" role="alert">
                This tag appears in {viewModel.deleteReferenceCount} save(s). Deleting it may break
                those saves.
              </p>
            {/if}
            <div class="flex gap-3">
              <button
                type="button"
                class="btn btn-error btn-xs"
                onclick={() =>
                  viewModel.confirmDelete({ force: viewModel.hasDeleteReferences })}
              >
                Delete
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => viewModel.cancelDelete()}
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</BaseViewModelContainer>
