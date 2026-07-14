<script lang="ts">
// apps/frontend/client/src/lib/components/base_view_model_container.svelte
import type { BaseViewModelInterface } from '@aikami/frontend/services';
import type { Snippet } from 'svelte';
import { onMount } from 'svelte';
import AppLoading from './app_loading.svelte';

type Props = {
  viewModel: BaseViewModelInterface;
  /**
   * Element id for testing
   *
   * @default className
   */
  id?: string;
  fillHeight?: boolean;
  children: Snippet;
  class?: string;
  /**
   * The HTML element to render.
   * @default 'div'
   */
  element?: 'div' | 'footer' | 'header' | 'main' | 'section' | 'article' | 'aside' | 'nav';
};

let {
  viewModel,
  id,
  fillHeight = false,
  children,
  class: classStyle,
  element = 'div',
}: Props = $props();

onMount(() => {
  if (viewModel.__mounted) {
    return;
  }
  viewModel.__mounted = true;

  void viewModel.initialize();

  return () => {
    viewModel.dispose();
  };
});
</script>

<svelte:element
  this={element}
  data-testid={id || viewModel._className}
  class:h-screen={fillHeight}
  class={classStyle}
>
  {#if viewModel.showLoadingView}
    <AppLoading />
  {:else}
    {@render children()}
  {/if}
</svelte:element>
