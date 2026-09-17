<script lang="ts">
// apps/frontend/client/src/lib/views/world/world_view.svelte
//
// World surface — the Codex section for knowledge and affiliations: people the
// player has met, places they know, faction standings, discovered lore, and the
// shared gallery.
//
// C-543 PART B: one CONTENT presentation shared by the standalone modal wrapper
// and the management workspace. The workspace header and its single Return
// action belong to the host, so this view contributes no title or Close control
// there.

import { BaseViewModelContainer, Image } from '$components';
import type { WorldViewModelInterface } from './world_view_model.svelte';

type Props = {
  viewModel: WorldViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#snippet children()}
    {#snippet worldBody()}
      <div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <!-- Tabs -->
        <div
          class="flex flex-wrap gap-1 border-b border-brass/20 px-1 py-2"
          data-testid="world-tabs"
        >
          <button
            type="button"
            class="game-workspace__nav-item"
            class:bg-primary={viewModel.activeTab === 'people'}
            class:text-primary-content={viewModel.activeTab === 'people'}
            aria-pressed={viewModel.activeTab === 'people'}
            onclick={() => viewModel.setActiveTab('people')}
          >
            People ({viewModel.people.length})
          </button>
          <button
            type="button"
            class="game-workspace__nav-item"
            class:bg-primary={viewModel.activeTab === 'places'}
            class:text-primary-content={viewModel.activeTab === 'places'}
            aria-pressed={viewModel.activeTab === 'places'}
            onclick={() => viewModel.setActiveTab('places')}
          >
            Places ({viewModel.places.length})
          </button>
          <button
            type="button"
            class="game-workspace__nav-item"
            class:bg-primary={viewModel.activeTab === 'factions'}
            class:text-primary-content={viewModel.activeTab === 'factions'}
            aria-pressed={viewModel.activeTab === 'factions'}
            onclick={() => viewModel.setActiveTab('factions')}
          >
            Factions ({viewModel.factions.length})
          </button>
          <button
            type="button"
            class="game-workspace__nav-item"
            class:bg-primary={viewModel.activeTab === 'lore'}
            class:text-primary-content={viewModel.activeTab === 'lore'}
            aria-pressed={viewModel.activeTab === 'lore'}
            onclick={() => viewModel.setActiveTab('lore')}
          >
            Lore ({viewModel.lore.length})
          </button>
          <button
            type="button"
            class="game-workspace__nav-item"
            class:bg-primary={viewModel.activeTab === 'gallery'}
            class:text-primary-content={viewModel.activeTab === 'gallery'}
            aria-pressed={viewModel.activeTab === 'gallery'}
            onclick={() => viewModel.setActiveTab('gallery')}
          >
            Gallery ({viewModel.gallery.length})
          </button>
        </div>

        <div class="shrink-0 border-b border-brass/10 px-1 py-2">
          <label class="block">
            <span class="sr-only">Search world knowledge</span>
            <input
              class="input input-bordered w-full"
              type="search"
              placeholder="Search people, places, and lore…"
              data-testid="world-search"
              value={viewModel.searchQuery}
              oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
            >
          </label>
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-2">
          {#if viewModel.activeTabEmpty}
            <div class="game-empty">
              <p class="game-section-title">Nothing here yet</p>
              <p class="game-metadata max-w-sm" data-testid="world-empty">
                The Codex only shows what this campaign has discovered.
              </p>
            </div>
          {:else if viewModel.visibleEntries.length === 0}
            <p class="game-metadata">No entries match “{viewModel.searchQuery}”.</p>
          {:else if viewModel.activeTab === 'gallery'}
            <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each viewModel.visibleEntries as entry (entry.id)}
                <li class="game-surface--inset overflow-hidden rounded-lg">
                  {#if entry.url}
                    <Image src={entry.url} alt={entry.name} class="h-28 w-full object-cover" />
                  {/if}
                  <div class="p-2">
                    <p class="truncate game-body-text" title={entry.name}>
                      {entry.name}
                    </p>
                    <p class="game-metadata">{entry.provenance}</p>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <ul class="space-y-2">
              {#each viewModel.visibleEntries as entry (entry.id)}
                <li class="border-b border-brass/15 py-2.5" data-testid="world-entry">
                  <div class="flex items-baseline gap-2">
                    <h3 class="game-body-text font-semibold">{entry.name}</h3>
                    {#if entry.score !== undefined}
                      <span
                        class="ml-auto badge badge-sm game-numeric"
                        data-testid="world-entry-score"
                      >
                        {entry.score}
                      </span>
                    {/if}
                  </div>
                  <p class="text-sm text-base-content/80">{entry.detail}</p>
                  <p class="mt-1 game-metadata">{entry.provenance}</p>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/snippet}

    {#if viewModel.isStandalonePresentation}
      <div
        class={viewModel.overlayClass}
        role="dialog"
        aria-modal="true"
        aria-label="World"
        tabindex="-1"
        data-testid="world-overlay"
        onclick={(event) => viewModel.handleBackdropClick(event)}
        onkeydown={(event) => viewModel.handleKeyDown(event)}
      >
        <div
          class="game-surface game-surface--raised mx-auto flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden"
        >
          <div class="flex items-center gap-2 border-b border-brass/20 px-4 py-2">
            <h2 class="game-section-title">World</h2>
            <span class="game-metadata">People, places, factions, lore, and media</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs ml-auto text-error"
              data-testid="world-close"
              onclick={() => viewModel.close()}
            >
              Close
            </button>
          </div>
          {@render worldBody()}
        </div>
      </div>
    {:else}
      <div class="flex h-full min-h-0 w-full flex-col overflow-hidden" data-testid="world-overlay">
        {@render worldBody()}
      </div>
    {/if}
  {/snippet}
</BaseViewModelContainer>
