<script lang="ts">
// apps/frontend/client/src/lib/views/world/world_view.svelte
//
// World overlay — the Codex section for knowledge and affiliations: people the
// player has met, places they know, faction standings, discovered lore, and the
// shared gallery. Rows show their provenance as secondary text.

import { BaseViewModelContainer, Image } from '$components';
import type { WorldViewModelInterface } from './world_view_model.svelte';

type Props = {
  viewModel: WorldViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="World"
    tabindex="-1"
    data-testid="world-overlay"
    onclick={(event: MouseEvent) => viewModel.handleBackdropClick(event)}
    onkeydown={(event: KeyboardEvent) => viewModel.handleKeyDown(event)}
  >
    <div
      class="mx-auto flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200/95 shadow-2xl"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 border-b border-base-300 px-4 py-2">
        <h2 class="text-sm font-bold text-primary">World</h2>
        <span class="text-xs text-base-content/50">People, places, factions, lore, and media</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs ml-auto text-error"
          data-testid="world-close"
          onclick={() => viewModel.close()}
        >
          Close
        </button>
      </div>

      <!-- Tabs -->
      <div
        class="flex flex-wrap gap-1 border-b border-base-300 px-4 py-1.5"
        data-testid="world-tabs"
      >
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'people'}
          class:text-primary-content={viewModel.activeTab === 'people'}
          class:text-muted={viewModel.activeTab !== 'people'}
          aria-pressed={viewModel.activeTab === 'people'}
          onclick={() => viewModel.setActiveTab('people')}
        >
          People ({viewModel.people.length})
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'places'}
          class:text-primary-content={viewModel.activeTab === 'places'}
          class:text-muted={viewModel.activeTab !== 'places'}
          aria-pressed={viewModel.activeTab === 'places'}
          onclick={() => viewModel.setActiveTab('places')}
        >
          Places ({viewModel.places.length})
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'factions'}
          class:text-primary-content={viewModel.activeTab === 'factions'}
          class:text-muted={viewModel.activeTab !== 'factions'}
          aria-pressed={viewModel.activeTab === 'factions'}
          onclick={() => viewModel.setActiveTab('factions')}
        >
          Factions ({viewModel.factions.length})
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'lore'}
          class:text-primary-content={viewModel.activeTab === 'lore'}
          class:text-muted={viewModel.activeTab !== 'lore'}
          aria-pressed={viewModel.activeTab === 'lore'}
          onclick={() => viewModel.setActiveTab('lore')}
        >
          Lore ({viewModel.lore.length})
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'gallery'}
          class:text-primary-content={viewModel.activeTab === 'gallery'}
          class:text-muted={viewModel.activeTab !== 'gallery'}
          aria-pressed={viewModel.activeTab === 'gallery'}
          onclick={() => viewModel.setActiveTab('gallery')}
        >
          Gallery ({viewModel.gallery.length})
        </button>
      </div>

      <div class="shrink-0 border-b border-base-300 px-4 py-1.5">
        <label class="block">
          <span class="sr-only">Search world knowledge</span>
          <input
            class="input input-bordered input-sm w-full"
            type="search"
            placeholder="Search people, places, and lore…"
            data-testid="world-search"
            value={viewModel.searchQuery}
            oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
          >
        </label>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        {#if viewModel.activeTabEmpty}
          <p class="text-sm text-base-content/50" data-testid="world-empty">
            Nothing recorded here yet — the Codex only shows what this campaign has discovered.
          </p>
        {:else if viewModel.visibleEntries.length === 0}
          <p class="text-sm text-base-content/50">No entries match “{viewModel.searchQuery}”.</p>
        {:else if viewModel.activeTab === 'gallery'}
          <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {#each viewModel.visibleEntries as entry (entry.id)}
              <li class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
                {#if entry.url}
                  <Image src={entry.url} alt={entry.name} class="h-28 w-full object-cover" />
                {/if}
                <div class="p-2">
                  <p class="truncate text-xs font-medium text-base-content" title={entry.name}>
                    {entry.name}
                  </p>
                  <p class="text-[10px] text-base-content/50">{entry.provenance}</p>
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <ul class="space-y-2">
            {#each viewModel.visibleEntries as entry (entry.id)}
              <li
                class="rounded-lg border border-base-300 bg-base-100 p-3"
                data-testid="world-entry"
              >
                <div class="flex items-baseline gap-2">
                  <h3 class="text-sm font-semibold text-base-content">{entry.name}</h3>
                  {#if entry.score !== undefined}
                    <span class="ml-auto badge badge-sm" data-testid="world-entry-score">
                      {entry.score}
                    </span>
                  {/if}
                </div>
                <p class="text-xs text-base-content/70">{entry.detail}</p>
                <p class="mt-1 text-[10px] text-base-content/40">{entry.provenance}</p>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
