<script lang="ts">
// apps/frontend/hub/src/lib/views/catalog/components/catalog_asset_tile.svelte
// One catalog grid tile (C-396 AC-1 visual / AC-5): a single-frame thumbnail
// (never the raw sheet), a display name, and a license badge.
import type { CatalogAssetEntry } from '@aikami/schemas';
import { assetDisplayName, hasNoLicense } from '$utils/catalog.ts';

type Props = {
  entry: CatalogAssetEntry;
  /** Resolved thumbnail URL — undefined when the entry has no thumbnail. */
  previewUrl: string | undefined;
  onSelect: (entry: CatalogAssetEntry) => void;
};

let { entry, previewUrl, onSelect }: Props = $props();

const displayName = $derived(assetDisplayName(entry));

const licenseBadge = $derived(
  hasNoLicense(entry) ? 'Unknown' :
  entry.licenses.length === 1 ? entry.licenses[0] :
  `${entry.licenses[0]} +${entry.licenses.length - 1}`
);

const isUnknown = $derived(hasNoLicense(entry));
</script>

<button
  type="button"
  data-testid="catalog-asset-tile"
  onclick={() => onSelect(entry)}
  class="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
>
  <div class="flex aspect-square items-center justify-center overflow-hidden bg-muted/30">
    {#if previewUrl}
      <img
        src={previewUrl}
        alt={`Preview of ${displayName}`}
        loading="lazy"
        class="h-full w-full object-contain transition-transform group-hover:scale-105"
      >
    {:else}
      <div
        class="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-muted-foreground/40 text-muted-foreground"
        role="img"
        aria-label={`Preview unavailable for ${displayName}`}
      >
        <svg
          role="img"
          aria-label="Preview unavailable"
          class="h-8 w-8"
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
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-1 p-3">
    <span class="line-clamp-2 text-sm font-medium text-foreground">{displayName}</span>
    <span
      class="inline-flex w-fit max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide
        {isUnknown
          ? 'border-border text-muted-foreground'
          : 'border-primary/30 bg-primary/5 text-primary'}"
      title={entry.licenses.join(', ')}
    >
      {licenseBadge}
    </span>
  </div>
</button>
