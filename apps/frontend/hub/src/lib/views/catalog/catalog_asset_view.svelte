<script lang="ts">
// apps/frontend/hub/src/lib/views/catalog/catalog_asset_view.svelte
// Asset detail page (C-396 AC-3): preview, size, license, attribution.
import BaseViewModelContainer from '$components/base_view_model_container.svelte';
import type { CatalogAssetViewModelInterface } from './catalog_asset_view_model.svelte.ts';

type Props = { viewModel: CatalogAssetViewModelInterface };
const { viewModel }: Props = $props();

const formatLicense = (license: string): string => {
  const trimmed = license.trim();
  return trimmed.toLowerCase() === 'unknown' ? 'Unknown' : trimmed;
};
</script>

<BaseViewModelContainer
  {viewModel}
  id="catalog-asset"
  class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6"
>
  <!-- Breadcrumb -->
  <nav aria-label="Breadcrumb" class="text-sm text-muted-foreground">
    <button
      type="button"
      class="transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onclick={() => viewModel.goToLanding()}
    >
      Catalog
    </button>
    <span class="mx-2" aria-hidden="true">/</span>
    <button
      type="button"
      class="transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onclick={() => viewModel.goToCategory()}
    >
      {viewModel.categoryLabel}
    </button>
    <span class="mx-2" aria-hidden="true">/</span>
    <span class="text-foreground">{viewModel.displayName}</span>
  </nav>

  <div class="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
    <!-- Preview -->
    <div
      class="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30"
    >
      {#if viewModel.previewUrl}
        <img
          src={viewModel.previewUrl}
          alt={`Preview of ${viewModel.displayName}`}
          class="h-full w-full object-contain"
          data-testid="catalog-asset-preview"
        >
      {:else}
        <div
          class="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground"
          data-testid="catalog-asset-preview-unavailable"
        >
          <svg
            role="img"
            aria-label="Preview unavailable"
            class="h-10 w-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
            />
          </svg>
          <p class="text-sm">Preview unavailable</p>
        </div>
      {/if}
    </div>

    <!-- Metadata -->
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="font-display text-2xl text-foreground">{viewModel.displayName}</h1>
        <div
          class="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
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
      </div>

      <dl class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Size</dt>
          <dd class="mt-0.5 text-foreground">{viewModel.sizeLabel}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Type</dt>
          <dd class="mt-0.5 text-foreground">{viewModel.entry.ext}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Category</dt>
          <dd class="mt-0.5 text-foreground">{viewModel.categoryLabel}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-muted-foreground">Tag</dt>
          <dd class="mt-0.5 break-all text-foreground">{viewModel.entry.tag}</dd>
        </div>
      </dl>

      <!-- License -->
      <section aria-labelledby="license-heading">
        <h2 id="license-heading" class="font-display text-base text-foreground">License</h2>
        {#if viewModel.isLicenseUnknown}
          <p class="mt-1 text-sm text-muted-foreground" data-testid="catalog-license-unknown">
            Unknown
          </p>
        {:else}
          <ul class="mt-1 flex flex-wrap gap-2">
            {#each viewModel.entry.licenses as license (license)}
              <li
                class="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary"
                data-testid="catalog-license"
              >
                {formatLicense(license)}
              </li>
            {/each}
          </ul>
        {/if}
        {#if viewModel.entry.licenseNote}
          <p class="mt-2 text-xs text-muted-foreground">{viewModel.entry.licenseNote}</p>
        {/if}
      </section>

      <!-- Attribution -->
      <section aria-labelledby="attribution-heading">
        <h2 id="attribution-heading" class="font-display text-base text-foreground">Attribution</h2>
        {#if viewModel.authors}
          <ul class="mt-1 flex flex-wrap gap-2">
            {#each viewModel.authors as author (author)}
              <li
                class="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
                data-testid="catalog-author"
              >
                {author}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-1 text-sm text-muted-foreground" data-testid="catalog-attribution-unknown">
            Attribution unavailable.
          </p>
        {/if}
        {#if viewModel.entry.sourceUrls.length > 0}
          <ul class="mt-2 flex flex-col gap-1">
            {#each viewModel.entry.sourceUrls as sourceUrl (sourceUrl)}
              <li>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  class="text-xs text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  data-testid="catalog-source-link"
                >
                  {sourceUrl}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  </div>
</BaseViewModelContainer>
