<script lang="ts">
// apps/frontend/hub/src/lib/views/catalog/catalog_landing_view.svelte
// Catalog landing — public for everyone (C-396 AC-1).
import { BaseViewModelContainer } from '$components';
import type { CatalogLandingViewModelInterface } from './catalog_landing_view_model.svelte.ts';

type Props = { viewModel: CatalogLandingViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer
  {viewModel}
  id="catalog-landing"
  class="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6"
>
  {#if viewModel.hasError}
    <!-- Explicit degraded state (C-396 Quality Requirements): the static
         index is unreachable — never a blank list, never a 500. -->
    <div
      class="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-10 text-center"
      data-testid="catalog-error-state"
    >
      <h1 class="font-display text-2xl text-foreground">Catalog unavailable</h1>
      <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The catalog index could not be loaded. Please try again in a moment.
      </p>
      <button
        type="button"
        class="mt-6 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        onclick={() => viewModel.retry()}
      >
        Try again
      </button>
    </div>
  {:else}
    <header class="flex flex-col gap-2">
      <h1 class="font-display text-3xl text-foreground">Catalog</h1>
      <p class="text-sm text-muted-foreground">
        Community-shared sprites, music, maps and tilesets — free to browse, for everyone.
      </p>
      <label
        class="mt-2 flex max-w-md items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
      >
        <svg
          role="img"
          aria-label="Search"
          class="h-4 w-4 shrink-0 text-muted-foreground"
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
          placeholder="Search categories…"
          value={viewModel.searchQuery}
          oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
          class="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
      </label>
    </header>

    {#if viewModel.visibleCategories.length === 0}
      <p
        class="py-10 text-center text-sm text-muted-foreground"
        data-testid="catalog-no-categories"
      >
        No categories match your search.
      </p>
    {:else}
      <ul
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="catalog-category-grid"
      >
        {#each viewModel.visibleCategories as category (category.id)}
          <li>
            <button
              type="button"
              class="flex w-full flex-col gap-1 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onclick={() => viewModel.goToCategory(category.id)}
            >
              <span class="font-display text-lg text-foreground">{category.label}</span>
              <span class="text-sm text-muted-foreground">
                {category.count.toLocaleString()}
                asset{category.count === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if viewModel.publishedAt}
      <footer class="mt-auto border-t border-border pt-4 text-xs text-muted-foreground">
        Index published {new Date(viewModel.publishedAt).toLocaleString()}
      </footer>
    {/if}
  {/if}
</BaseViewModelContainer>
