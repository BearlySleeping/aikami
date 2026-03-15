<script lang="ts">
  // apps/frontend/pwa/src/lib/views/characters/list/CharacterListView.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { CharacterLibraryViewModelInterface } from './character-list-view-model.svelte';

  interface Props {
    viewModel: CharacterLibraryViewModelInterface;
  }

  let { viewModel }: Props = $props();

  let fileInput: HTMLInputElement;
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-4">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">Character Library</h1>
      <button
        class="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        onclick={() => fileInput.click()}
      >
        Import Character
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".png,.json"
        multiple
        class="hidden"
        onchange={(event) => viewModel.handleFileUpload({ event })}
      >
    </header>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {#each viewModel.characters as character}
        <button
          class="bg-gray-800 hover:ring-2 text-left transition overflow-hidden rounded-lg ring-blue-500"
          onclick={() => viewModel.selectCharacter({ character })}
        >
          <div class="bg-gray-700 relative h-48">
            <div class="text-gray-500 absolute inset-0 flex items-center justify-center">
              Avatar
            </div>
          </div>
          <div class="p-3">
            <h3 class="truncate font-bold text-white">{character.name}</h3>
            <p class="text-gray-400 line-clamp-2 text-sm">{character.description}</p>
          </div>
        </button>
      {/each}

      {#if viewModel.characters.length === 0}
        <div class="text-gray-500 col-span-full py-10 text-center">
          No characters found. Import one to get started!
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
