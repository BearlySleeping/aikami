<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/sandbox/map/+page.svelte
  //
  // Dev route — wraps the shared WalkSandbox component with map loading.
  // Supplies the registry resolver for asset resolution.

  import { onMount } from 'svelte';
  import { WalkSandbox } from '@aikami/frontend/preview/sandbox';

  let resolver: import('@aikami/types').AssetResolver | undefined = $state(undefined);

  onMount(async () => {
    const { createRegistryAssetResolver } = await import('$lib/services/assets/registry_asset_resolver');
    resolver = createRegistryAssetResolver();
  });
</script>

<svelte:head>
  <title>Map Sandbox</title>
</svelte:head>

{#if resolver}
  <WalkSandbox {resolver} mapTag="sandbox_zone_a" />
{:else}
  <div class="flex items-center justify-center h-64 text-base-content/40">
    Loading map sandbox...
  </div>
{/if}
