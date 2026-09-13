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
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Creator Studio</h1>
      <p class="text-sm opacity-70">
        Generate an asset with your local engine, review it, and save it into your library. Saved
        assets resolve in-game through their tag.
      </p>
    </header>

    {#if !viewModel.generationEnabled}
      <div
        role="status"
        class="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
      >
        Asset generation is disabled (PUBLIC_ASSET_GENERATION is off). Generating and saving are
        unavailable.
      </div>
    {/if}

    <section class="flex flex-col gap-4 rounded border border-white/10 p-4">
      <div class="flex flex-col gap-1">
        <label for="studio-recipe" class="text-sm font-medium">Asset type</label>
        <select
          id="studio-recipe"
          class="rounded border border-white/15 bg-transparent px-2 py-1"
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
        <div class="flex flex-col gap-1">
          <label for="studio-npc" class="text-sm font-medium">NPC id</label>
          <input
            id="studio-npc"
            class="rounded border border-white/15 bg-transparent px-2 py-1"
            type="text"
            placeholder="merchant"
            value={viewModel.npcId}
            oninput={(event) => viewModel.setNpcId((event.target as HTMLInputElement).value)}
          >
          <p class="text-xs opacity-60">
            Saved as portraits:&lt;npc&gt;-neutral so the dialogue avatar resolver finds it.
          </p>
        </div>
      {/if}

      <div class="flex flex-col gap-1">
        <label for="studio-prompt" class="text-sm font-medium">Prompt</label>
        <textarea
          id="studio-prompt"
          class="min-h-24 rounded border border-white/15 bg-transparent px-2 py-1"
          value={viewModel.positivePrompt}
          oninput={(event) => viewModel.setPositivePrompt((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div class="flex flex-col gap-1">
        <label for="studio-negative" class="text-sm font-medium">Negative prompt (optional)</label>
        <input
          id="studio-negative"
          class="rounded border border-white/15 bg-transparent px-2 py-1"
          type="text"
          value={viewModel.negativePrompt}
          oninput={(event) =>
            viewModel.setNegativePrompt((event.target as HTMLInputElement).value)}
        >
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="rounded bg-emerald-600 px-3 py-1.5 font-medium disabled:opacity-40"
          disabled={!viewModel.canGenerate}
          onclick={() => viewModel.generate()}
        >
          Generate
        </button>
        <button
          type="button"
          class="rounded border border-white/20 px-3 py-1.5 disabled:opacity-40"
          disabled={!viewModel.isGenerating}
          onclick={() => viewModel.cancel()}
        >
          Cancel
        </button>
        <span class="text-sm opacity-70">{viewModel.generationStatus}</span>
      </div>

      {#if !viewModel.canGenerate}
        <p class="text-sm text-amber-400" role="status">{viewModel.generateDisabledReason}</p>
      {/if}

      {#if viewModel.hasGenerated}
        <div class="flex flex-col gap-3 rounded border border-white/10 p-3">
          <div class="flex flex-wrap gap-4 text-xs opacity-80">
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
              class="rounded bg-emerald-600 px-3 py-1.5 font-medium disabled:opacity-40"
              disabled={viewModel.isSaving}
              onclick={() => viewModel.save()}
            >
              Save to library
            </button>
            <span class="text-sm opacity-70">{viewModel.saveMessage}</span>
          </div>
        </div>
      {/if}

      {#if viewModel.errorMessage}
        <p class="text-sm text-red-400" role="alert">{viewModel.errorMessage}</p>
      {/if}
    </section>

    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium">My library</h2>
        <button
          type="button"
          class="rounded border border-white/20 px-3 py-1 text-sm"
          onclick={() => viewModel.refreshLibrary()}
        >
          Refresh
        </button>
      </div>

      {#if viewModel.isLibraryLoading}
        <p class="text-sm opacity-70">Loading…</p>
      {:else if viewModel.libraryRows.length === 0}
        <p class="text-sm opacity-70">
          Nothing generated yet. Assets you save appear here and are protected from cache eviction.
        </p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each viewModel.libraryRows as row (row.tag)}
            <li class="flex flex-wrap items-center gap-3 rounded border border-white/10 px-3 py-2">
              <span class="font-mono text-sm">{row.tag}</span>
              <span class="rounded bg-white/10 px-2 py-0.5 text-xs">{row.category}</span>
              <span class="rounded bg-white/10 px-2 py-0.5 text-xs">{row.provenanceLabel}</span>
              <span class="text-xs opacity-70">{row.sizeLabel}</span>
              <span class="text-xs opacity-70">{row.ext}</span>
              <span class="text-xs opacity-60">{row.createdAtLabel}</span>
              <span class="ml-auto flex gap-2">
                <button
                  type="button"
                  class="rounded border border-white/20 px-2 py-1 text-xs"
                  onclick={() => viewModel.beginRename(row.tag)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  class="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
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
        <div class="flex flex-wrap items-center gap-3 rounded border border-white/10 p-3">
          <label for="studio-rename" class="text-sm">New tag</label>
          <input
            id="studio-rename"
            class="rounded border border-white/15 bg-transparent px-2 py-1 font-mono text-sm"
            type="text"
            value={viewModel.renameValue}
            oninput={(event) => viewModel.setRenameValue((event.target as HTMLInputElement).value)}
          >
          <button
            type="button"
            class="rounded bg-emerald-600 px-3 py-1 text-sm"
            onclick={() => viewModel.confirmRename()}
          >
            Rename
          </button>
          <button
            type="button"
            class="rounded border border-white/20 px-3 py-1 text-sm"
            onclick={() => viewModel.cancelRename()}
          >
            Cancel
          </button>
        </div>
      {/if}

      {#if viewModel.hasDeleteTarget}
        <div class="flex flex-col gap-2 rounded border border-red-500/40 p-3">
          <p class="text-sm">
            Delete {viewModel.deleteTargetTag}? Its cached bytes are removed too.
          </p>
          {#if viewModel.hasDeleteReferences}
            <p class="text-sm text-amber-400" role="alert">
              This tag appears in {viewModel.deleteReferenceCount} save(s). Deleting it may break
              those saves.
            </p>
          {/if}
          <div class="flex gap-3">
            <button
              type="button"
              class="rounded bg-red-600 px-3 py-1 text-sm"
              onclick={() => viewModel.confirmDelete({ force: true })}
            >
              Delete
            </button>
            <button
              type="button"
              class="rounded border border-white/20 px-3 py-1 text-sm"
              onclick={() => viewModel.cancelDelete()}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </section>
  </div>
</BaseViewModelContainer>
