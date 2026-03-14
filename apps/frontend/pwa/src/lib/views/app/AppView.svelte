<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { PWAHookData } from '$lib/types/index.ts';
  import type { BaseMetaTags } from '$views/app/metadata/head-tags-view-model.svelte.ts';
  import { getAppViewModel } from './app-view-model.svelte.ts';
  import AppBar from './bar/AppBar.svelte';
  import NavigationDrawer from './drawer/navigation/NavigationDrawer.svelte';
  import AppFooter from './footer/AppFooter.svelte';
  import HeadTagsView from './metadata/HeadTagsView.svelte';

  interface Props {
    data: PWAHookData;
    children: Snippet;
  }

  let { data, children }: Props = $props();

  // svelte-ignore state_referenced_locally
  const viewModel = getAppViewModel({ data, className: 'AppViewModel' });

  const { isLoggedIn, navigationDrawerEnabled, showAppBar, showFooter } = viewModel;

  const defaultMetaTags: BaseMetaTags = {
    title: 'AiKami',
    description: 'AiKami',
    keywords: ['ai', 'game'],
  };
</script>

<HeadTagsView data={defaultMetaTags} baseURL={page.url.origin} path={page.url.pathname} />
<svelte:window on:beforeunload={(event) => viewModel.handleAppClose(event)} />

<BaseViewModelContainer {viewModel} class="drawer lg:drawer-open">
  <input id="left-drawer" type="checkbox" class="drawer-toggle">

  <div class="drawer-content flex h-screen flex-col">
    {#if showAppBar}
      <header><AppBar /></header>
    {/if}

    <main class="flex-1 overflow-y-auto">{@render children()}</main>

    {#if showFooter}
      <AppFooter />
    {/if}
  </div>

  {#if navigationDrawerEnabled && isLoggedIn}
    <NavigationDrawer />
  {/if}
</BaseViewModelContainer>
