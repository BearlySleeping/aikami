<script lang="ts">
import type { BaseViewModelInterface } from '@aikami/frontend/services/index.ts';
import { onMount } from 'svelte';

interface Props {
  viewModel: BaseViewModelInterface;
  /**
   * Element id for testing
   *
   * @default className
   */
  id?: string;
  fillHeight?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: Svelte slots can accept any content
  children: any;
  class?: string;
  /**
   * The HTML element to render.
   * @default 'div'
   */
  element?: 'div' | 'footer' | 'header' | 'main' | 'section' | 'article' | 'aside' | 'nav';
}

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
    class:min-h-screen={fillHeight}
    class={classStyle}
>
    {#if viewModel.showLoadingView}
        <AppLoading />
    {:else}
        {@render children()}
    {/if}
</svelte:element>
