<script lang="ts">
import type { Snippet } from 'svelte';
import { BaseViewModelContainer } from '$components';
import AppLoading from '$components/app_loading.svelte';
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

<BaseViewModelContainer {viewModel} class="flex h-screen">
  <div class="flex flex-1 flex-col overflow-hidden">
    {#if viewModel.showAppBar}
      <header><AppBar /></header>
    {/if}

    <div class="flex flex-1 overflow-hidden">
      {#if viewModel.navigationDrawerEnabled && viewModel.isLoggedIn}
        <NavigationDrawer />
      {/if}

      <main class="flex-1 overflow-y-auto relative">
        {#if viewModel.showAppLoading}
          <div class="absolute inset-0 z-50 flex items-center justify-center bg-background">
            <AppLoading />
          </div>
        {/if}

        {@render children()}
      </main>
    </div>
  </div>
</BaseViewModelContainer>

{#await import('./dialogs/app_dialogs_view.svelte') then { default: AppDialogsView }}
  <AppDialogsView />
{/await}
