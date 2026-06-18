<script lang="ts">
  import type { Snippet } from 'svelte';
  // apps/frontend/client/src/lib/views/app/app_view.svelte
  import { page } from '$app/stores';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import type { AppViewModelInterface } from './app_view_model.svelte.ts';
  import BootDiagnosticsView from './boot/boot_diagnostics_view.svelte';
  import { getBootDiagnosticsViewModel } from './boot/boot_diagnostics_view_model.svelte';

  type Props = {
    viewModel: AppViewModelInterface;
    children: Snippet;
  };

  let { viewModel, children }: Props = $props();

  const bootDiagnosticsViewModel = getBootDiagnosticsViewModel({
    className: 'BootDiagnosticsViewModel',
    onBootComplete: () => viewModel.onBootComplete(),
  });
</script>

{#if viewModel.showBootDiagnostics && !$page.url.pathname.startsWith('/settings') && !$page.url.pathname.startsWith('/dev') && $page.url.searchParams.get('skip-onboarding') === null}
  <BootDiagnosticsView viewModel={bootDiagnosticsViewModel} />
{:else}
  <BaseViewModelContainer {viewModel}> {@render children()} </BaseViewModelContainer>
{/if}

<ModeIndicator />

<style>
  /* Hide the default Firebase emulator warning banner injected by the SDK —
                                                                                                                                                                                                                                                                                         replaced by our custom ModeIndicator component. */
  :global(.firebase-emulator-warning) {
    display: none;
  }
</style>
