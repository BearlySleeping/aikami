<script lang="ts">
import type { Snippet } from 'svelte';
import { AppLoading, BaseViewModelContainer } from '$components';
import type { AppViewModelInterface } from './app_view_model.svelte.ts';
import AppBar from './bar/app_bar.svelte';
import NavigationDrawer from './drawer/navigation/navigation_drawer.svelte';
import HeadTagsView from './metadata/head_tags_view.svelte';

type Props = {
  viewModel: AppViewModelInterface;
  children: Snippet;
};

let { viewModel, children }: Props = $props();
</script>

<HeadTagsView data={viewModel.defaultMetaTags} />
<svelte:window on:beforeunload={(event) => viewModel.handleAppClose(event)} />

<BaseViewModelContainer {viewModel} fillHeight class="flex">
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if viewModel.showAppBar}
      <header><AppBar /></header>
    {/if}

    <div class="flex min-h-0 flex-1 overflow-hidden">
      {#if viewModel.navigationDrawerEnabled && viewModel.isNavigationDrawerOpen}
        <NavigationDrawer />
      {/if}

      <main class="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {#if viewModel.showAppLoading}
          <div class="absolute inset-0 z-50 flex items-center justify-center bg-base-100">
            <AppLoading />
          </div>
        {/if}

        {@render children()}
      </main>
    </div>
  </div>

  {#await import('./dialogs/app_dialogs_view.svelte') then { default: AppDialogsView }}
    <AppDialogsView />
  {/await}
</BaseViewModelContainer>
