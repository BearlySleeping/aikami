<script lang="ts">
// apps/frontend/hub/src/lib/views/catalog/category_view.svelte
// One category's browse page — grid, filter/search, streamed stats (C-396).
import { BaseViewModelContainer } from '$components';
import { resolveThumbnailUrl } from '$utils/catalog.ts';
import type { CategoryViewModelInterface } from './category_view_model.svelte.ts';
import CatalogAssetTile from './components/catalog_asset_tile.svelte';

type Props = { viewModel: CategoryViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer
  {viewModel}
  id="catalog-category"
  class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6"
>
  <!-- Breadcrumb -->
  <nav aria-label="Breadcrumb" class="text-sm text-base-content/60">
    <button
      type="button"
      class="transition-colors hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onclick={() => viewModel.goToLanding()}
    >
      Catalog
    </button>
    <span class="mx-2" aria-hidden="true">/</span>
    <span class="text-base-content">{viewModel.categoryLabel}</span>
  </nav>

  <header class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="font-display text-3xl text-base-content">{viewModel.categoryLabel}</h1>
      <p class="mt-1 text-sm text-base-content/60">
        {viewModel.totalCount.toLocaleString()}
        assets
      </p>
    </div>

    <!-- Streamed stats region (C-396 AC-4): aria-busy while pending. The
         pending branch is a static placeholder — never an infinite spinner,
         because with JS disabled the {#await} block never resolves. -->
    <div
      class="rounded-md border border-base-300 bg-base-200 px-3 py-1.5 text-xs text-base-content/60"
      aria-busy={viewModel.statsPending}
      data-testid="catalog-stats-region"
    >
      {#await viewModel.stats}
        <span aria-hidden="true">…</span>
      {:then stats}
        {#if stats}
          <span data-testid="catalog-stats"
            >{stats.packCount.toLocaleString()}
            pack{stats.packCount === 1 ? '' : 's'}</span
          >
        {:else}
          <span data-testid="catalog-stats-absent">stats unavailable</span>
        {/if}
      {/await}
    </div>
  </header>

  <!-- Filters -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
    <label
      class="flex max-w-md flex-1 items-center gap-2 rounded-md border border-base-300 bg-base-200 px-3 py-2"
    >
      <svg
        role="img"
        aria-label="Search"
        class="h-4 w-4 shrink-0 text-base-content/60"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="search"
        placeholder="Search assets in this category…"
        value={viewModel.searchQuery}
        oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
        aria-label="Search assets"
        class="w-full bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/60"
      >
    </label>

    {#if viewModel.subcategories.length > 1}
      <label class="flex items-center gap-2 text-sm text-base-content/60">
        <span>Subcategory</span>
        <select
          value={viewModel.subcategoryFilter ?? ''}
          onchange={(event) => {
            const value = event.currentTarget.value;
            viewModel.setSubcategoryFilter(value === '' ? undefined : value);
          }}
          aria-label="Filter by subcategory"
          class="rounded-md border border-base-300 bg-base-200 px-2 py-2 text-sm text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <option value="">All</option>
          {#each viewModel.subcategories as subcategory (subcategory)}
            <option value={subcategory}>{subcategory}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if viewModel.hasActiveFilters}
      <button
        type="button"
        class="rounded-md border border-base-300 px-3 py-2 text-sm text-base-content/60 transition-colors hover:bg-base-300 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onclick={() => viewModel.resetFilters()}
      >
        Reset filters
      </button>
    {/if}
  </div>

  {#if viewModel.filterResultCount === 0}
    <p class="py-10 text-center text-sm text-base-content/60" data-testid="catalog-empty-state">
      No assets match your filters.
    </p>
  {:else}
    <ul
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      data-testid="catalog-asset-grid"
    >
      {#each viewModel.visibleEntries as entry (entry.tag)}
        <li>
          <CatalogAssetTile
            {entry}
            previewUrl={resolveThumbnailUrl(viewModel.originUrl, entry)}
            onSelect={(selected) => viewModel.goToAsset(selected)}
          />
        </li>
      {/each}
    </ul>

    {#if viewModel.hasMore}
      <div class="flex justify-center">
        <button
          type="button"
          class="rounded-md border border-base-300 px-5 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onclick={() => viewModel.showMore()}
          data-testid="catalog-show-more"
        >
          Show more ({viewModel.filterResultCount - viewModel.visibleEntries.length}
          remaining)
        </button>
      </div>
    {/if}
  {/if}
</BaseViewModelContainer>
