<script lang="ts">
// apps/frontend/hub/src/lib/views/community/theme_listing_view.svelte
//
// The public theme listing page (C-530 AC-3) — author, version, licence, the
// variants the package actually ships, its theme-API range, package size and
// the server's support verdict.
// Logicless: every expression is a direct ViewModel member.
import { BaseViewModelContainer } from '$components';
import type { ThemeListingViewModelInterface } from './theme_listing_view_model.svelte.ts';

type Props = { viewModel: ThemeListingViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer
  {viewModel}
  id="theme-listing"
  class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6"
>
  <nav aria-label="Breadcrumb" class="text-sm text-base-content/60">
    <a class="transition-colors hover:text-base-content" href="/catalog">Catalog</a>
    <span class="mx-2" aria-hidden="true">/</span>
    <span>Community</span>
    <span class="mx-2" aria-hidden="true">/</span>
    <span class="text-base-content">Themes</span>
  </nav>

  <header class="flex flex-col gap-1">
    <h1 class="font-display text-3xl text-base-content">Community Themes</h1>
    <p class="text-sm text-base-content/60">
      Interface themes other players published, reviewed and approved before they appear here.
      A theme is a declarative token package: it can change colours, spacing and font roles, and
      it cannot run code, load a remote resource or read your campaign.
    </p>
  </header>

  {#if viewModel.degraded}
    <p class="py-10 text-center text-sm text-base-content/60" data-testid="theme-listing-degraded">
      Theme discovery is unavailable in this deployment. Installed themes keep working locally.
    </p>
  {:else if viewModel.isEmpty}
    <p class="py-10 text-center text-sm text-base-content/60" data-testid="theme-listing-empty">
      No approved themes have been published yet.
    </p>
  {:else}
    <ul class="grid gap-4 sm:grid-cols-2" data-testid="theme-listing">
      {#each viewModel.visibleRows as row (`${row.themeId}@${row.version}`)}
        <li
          class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-200 p-4"
          data-testid="theme-listing-row"
        >
          <div class="flex flex-wrap items-baseline gap-2">
            <h2 class="font-medium text-base-content">
              <a class="link" href={row.detailHref} data-testid="theme-listing-link">{row.name}</a>
            </h2>
            <span class="font-mono text-xs text-base-content/70"
              >{row.themeId}@{row.version}</span
            >
          </div>

          <dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/70">
            <div class="flex gap-1">
              <dt class="text-base-content/50">By</dt>
              <dd data-testid="theme-listing-author">{row.authorDisplayName}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="text-base-content/50">Licence</dt>
              <dd data-testid="theme-listing-license">{row.license}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="text-base-content/50">Variants</dt>
              <dd data-testid="theme-listing-variants">{row.variantsLabel}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="text-base-content/50">Package</dt>
              <dd data-testid="theme-listing-size">{row.sizeLabel}</dd>
            </div>
          </dl>

          <p class="text-[11px] text-base-content/60" data-testid="theme-listing-api">
            {row.apiLabel} —
            {row.apiSupported ? 'compatible with this client' : 'not compatible with this client'}
          </p>
        </li>
      {/each}
    </ul>

    <div class="flex flex-wrap items-center justify-center gap-3">
      {#if viewModel.hasMore}
        <button
          type="button"
          class="rounded-md border border-base-300 px-5 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onclick={() => viewModel.showMore()}
          data-testid="theme-listing-show-more"
        >
          Show more
        </button>
      {/if}

      {#if viewModel.nextPageHref}
        <a
          class="text-sm text-primary underline"
          href={viewModel.nextPageHref}
          data-testid="theme-listing-next-page"
        >
          Next page
        </a>
      {/if}
    </div>
  {/if}
</BaseViewModelContainer>
