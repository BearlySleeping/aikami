<script lang="ts">
  // apps/frontend/client/src/lib/views/app/app_view.svelte
  import { untrack } from 'svelte';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { PWAHookData } from '$types';
  import { getAppViewModel } from './app_view_model.svelte.ts';

  type Props = {
    data: PWAHookData | null;
    children: import('svelte').Snippet;
  };

  let { data, children }: Props = $props();

  // Layout data is static per SvelteKit mount — read non-reactively.
  const viewModel = untrack(() =>
    getAppViewModel({
      className: 'AppViewModel',
      data: data ?? {},
    }),
  );
</script>

<BaseViewModelContainer {viewModel}> {@render children()} </BaseViewModelContainer>
