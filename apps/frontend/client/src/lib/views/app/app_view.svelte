<script lang="ts">
  // apps/frontend/client/src/lib/views/app/app_view.svelte
  import type { Snippet } from 'svelte';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import type { AppViewModelInterface } from './app_view_model.svelte.ts';

  type Props = {
    viewModel: AppViewModelInterface;
    children: Snippet;
  };

  let { viewModel, children }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}> {@render children()} </BaseViewModelContainer>

<ModeIndicator />

<style>
  /* Hide the default Firebase emulator warning banner injected by the SDK —
           replaced by our custom ModeIndicator component. */
  :global(.firebase-emulator-warning) {
    display: none;
  }
</style>
