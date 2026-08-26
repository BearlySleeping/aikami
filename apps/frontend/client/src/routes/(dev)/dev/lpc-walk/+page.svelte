<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/lpc-walk/+page.svelte
  //
  // Dev route — wraps the shared WalkSandbox component.
  // Supplies the registry resolver for asset resolution.
  // Uses a dedicated ViewModel for resolver/manifest loading.

  import { WalkSandbox } from '@aikami/frontend/preview/sandbox';
  import {
    getLpcWalkViewModel,
    type LpcWalkViewModelInterface,
  } from './lpc_walk_view_model.svelte';

  let viewModel = $state<LpcWalkViewModelInterface | undefined>(undefined);

  $effect(() => {
    const vm = getLpcWalkViewModel({ className: 'LpcWalk' });
    viewModel = vm;
    void vm.initialize();
    return () => {
      void vm.dispose().catch((err: unknown) => {
        console.error('LpcWalk route dispose failed:', err);
      });
    };
  });
</script>

<svelte:head>
  <title>LPC Walk Sandbox</title>
</svelte:head>

{#if viewModel?.resolver && !viewModel?.loading}
  <WalkSandbox resolver={viewModel.resolver} />
{:else}
  <div class="flex items-center justify-center h-64 text-base-content/40">
    Loading walk sandbox...
  </div>
{/if}
