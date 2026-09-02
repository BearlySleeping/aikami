<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/lpc/+page.svelte
//
// Dev route — wraps the shared LpcPreview component.
// Supplies the registry resolver and catalog from the client's asset store.

import { LpcPreview } from '@aikami/frontend-preview';
import { onMount } from 'svelte';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';

let resolver: import('@aikami/types').AssetResolver | undefined = $state(undefined);
let allSlots: readonly import('@aikami/frontend/preview').LpcSlotDef[] | undefined =
  $state(undefined);

onMount(async () => {
  const { createRegistryAssetResolver } = await import(
    '$lib/services/assets/registry_asset_resolver'
  );
  resolver = createRegistryAssetResolver();

  const { assetStore } = await import('$lib/services/assets/asset_store.svelte');
  await assetStore.fetchManifest();

  allSlots = getLpcCatalog()
    .slots as unknown as readonly import('@aikami/frontend/preview').LpcSlotDef[]; // guard-ignore lint/type-safety/casting: LPC slot catalog return type - runtime shape guaranteed
});
</script>

<svelte:head>
  <title>LPC Preview</title>
</svelte:head>

{#if resolver && allSlots}
  <LpcPreview
    {resolver}
    allSlots={allSlots as import('@aikami/frontend/preview').LpcSlotDef[]}
    controls={true}
  />
{:else}
  <div class="flex items-center justify-center h-64 text-base-content/40">
    Loading LPC preview...
  </div>
{/if}
