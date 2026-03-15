<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/AppView.svelte
  import type { Snippet } from 'svelte';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { BaseMetaTags } from '$views/app/metadata/head-tags-view-model.svelte.ts';
  import type { AppViewModelInterface } from './app-view-model.svelte.ts';
  import AppBar from './bar/AppBar.svelte';
  import NavigationDrawer from './drawer/navigation/NavigationDrawer.svelte';
  import AppFooter from './footer/AppFooter.svelte';
  import HeadTagsView from './metadata/HeadTagsView.svelte';

  type Props = {
    viewModel: AppViewModelInterface;
    children: Snippet;
  };

  let { viewModel, children }: Props = $props();
</script>

<HeadTagsView data={viewModel.defaultMetaTags} />
<svelte:window on:beforeunload={(event) => viewModel.handleAppClose(event)} />

<BaseViewModelContainer {viewModel} class="drawer lg:drawer-open">
  <input id="left-drawer" type="checkbox" class="drawer-toggle">

  <div class="drawer-content flex h-screen flex-col">
    {#if viewModel.showAppBar}
      <header><AppBar /></header>
    {/if}

    <main class="flex-1 overflow-y-auto">{@render children()}</main>

    {#if viewModel.showFooter}
      <AppFooter />
    {/if}
  </div>

  {#if viewModel.navigationDrawerEnabled && viewModel.isLoggedIn}
    <NavigationDrawer />
  {/if}
</BaseViewModelContainer>
