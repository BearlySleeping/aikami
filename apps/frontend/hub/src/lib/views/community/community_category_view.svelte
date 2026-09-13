<script lang="ts">
// apps/frontend/hub/src/lib/views/community/community_category_view.svelte
//
// One category's public community-asset browse page (C-513 AC-4) — grid,
// attribution/licence, the public CDN URL and the "Show more" window.
// Logicless: every expression is a direct ViewModel member.
import { BaseViewModelContainer } from '$components';
import type { CommunityCategoryViewModelInterface } from './community_category_view_model.svelte.ts';

type Props = { viewModel: CommunityCategoryViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer
  {viewModel}
  id="community-category"
  class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6"
>
  <!-- Breadcrumb -->
  <nav aria-label="Breadcrumb" class="text-sm text-base-content/60">
    <button
      type="button"
      class="transition-colors hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onclick={() => viewModel.goToCatalog()}
    >
      Catalog
    </button>
    <span class="mx-2" aria-hidden="true">/</span>
    <span>Community</span>
    <span class="mx-2" aria-hidden="true">/</span>
    <span class="text-base-content">{viewModel.categoryLabel}</span>
  </nav>

  <header class="flex flex-col gap-1">
    <h1 class="font-display text-3xl text-base-content">Community {viewModel.categoryLabel}</h1>
    <p class="text-sm text-base-content/60">
      Assets other players made and published, reviewed and approved before they appear here.
      Importing one copies its bytes to your device, so it keeps working offline.
    </p>
  </header>

  {#if !viewModel.hasAssets}
    <p class="py-10 text-center text-sm text-base-content/60" data-testid="community-empty-state">
      No approved community assets in this category yet.
    </p>
  {:else}
    <ul class="flex flex-col gap-3" data-testid="community-asset-list">
      {#each viewModel.visibleRows as row (row.tag)}
        <li
          class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-200 p-4"
          data-testid="community-asset-row"
        >
          <div class="flex flex-wrap items-baseline gap-2">
            <h2 class="font-medium text-base-content">{row.title}</h2>
            <span class="font-mono text-xs text-base-content/70">{row.tag}</span>
            <span class="rounded bg-base-300 px-1.5 py-0.5 text-[10px] text-base-content/70"
              >{row.category}</span
            >
            <span class="text-[10px] text-base-content/50">{row.revisionLabel}</span>
          </div>

          <dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/70">
            <div class="flex gap-1">
              <dt class="text-base-content/50">By</dt>
              <dd data-testid="community-asset-attribution">{row.attribution}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="text-base-content/50">Licence</dt>
              <dd data-testid="community-asset-license">{row.license}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="text-base-content/50">Size</dt>
              <dd>{row.sizeLabel}</dd>
            </div>
          </dl>

          {#if row.sourceUrl}
            <p class="truncate font-mono text-[10px] text-base-content/50">
              <span class="text-base-content/40">Source</span>
              <a
                class="link"
                href={row.sourceUrl}
                rel="noreferrer noopener"
                data-testid="community-asset-source-url"
                >{row.sourceUrl}</a
              >
            </p>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex flex-wrap items-center justify-center gap-3">
      {#if viewModel.hasMore}
        <button
          type="button"
          class="rounded-md border border-base-300 px-5 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onclick={() => viewModel.showMore()}
          data-testid="community-show-more"
        >
          Show more ({viewModel.currentPageCount - viewModel.visibleRows.length}
          remaining)
        </button>
      {/if}

      {#if viewModel.nextPageHref}
        <a
          class="text-sm text-primary underline"
          href={viewModel.nextPageHref}
          data-testid="community-next-page"
        >
          Next page
        </a>
      {/if}
    </div>
  {/if}
</BaseViewModelContainer>
