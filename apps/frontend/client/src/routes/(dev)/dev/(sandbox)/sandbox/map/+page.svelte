<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/sandbox/map/+page.svelte
//
// Dev route — wraps the shared WalkSandbox component with map loading.
// Supplies the registry resolver for asset resolution.
// Fetches asset catalog before creating/rendering WalkSandbox.
// Uses a dedicated ViewModel for resolver/manifest loading.

import { WalkSandbox } from '@aikami/frontend-preview/sandbox';
import {
  getMapSandboxRouteViewModel,
  type MapSandboxRouteViewModelInterface,
} from './map_sandbox_route_view_model.svelte';

let viewModel = $state<MapSandboxRouteViewModelInterface | undefined>(undefined);

$effect(() => {
  const vm = getMapSandboxRouteViewModel({ className: 'MapSandboxRoute' });
  viewModel = vm;
  void vm.initialize();
  return () => {
    void vm.dispose().catch(() => {
      // dispose silently
    });
  };
});
</script>

<svelte:head>
  <title>Map Sandbox</title>
</svelte:head>

{#if viewModel?.resolver && !viewModel?.loading}
  <WalkSandbox resolver={viewModel.resolver} mapTag="maps:sandbox_zone_a" />
{:else}
  <div class="flex items-center justify-center h-64 text-base-content/40">
    Loading map sandbox...
  </div>
{/if}
