<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/drawer/navigation/NavigationDrawer.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import { getNavigationDrawerViewModel } from './navigation-drawer-view-model.svelte.ts';

  const viewModel = getNavigationDrawerViewModel({
    className: 'NavigationDrawerViewModel',
  });
</script>

<BaseViewModelContainer {viewModel} class="drawer-side">
  <label for="left-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
  <ul class="menu bg-base-200 text-base-content min-h-full w-64 p-4">
    <!-- Logo/Brand -->
    <li class="mb-4">
      <button class="text-xl font-bold" onclick={() => viewModel.goToRoute("dashboard")}>
        Aikami
      </button>
    </li>

    <!-- Navigation Items -->
    {#each viewModel.navigationItems as section}
      <li class="menu-title"><span>{section.title}</span></li>
      {#each section.items as item}
        <li>
          <button
            class="flex items-center gap-2"
            class:active={item.active}
            onclick={() => viewModel.goToRoute(item.route)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon} />
            </svg>
            {item.label}
          </button>
        </li>
      {/each}
    {/each}

    <!-- Logout -->
    <li class="mt-auto">
      <button class="flex items-center gap-2 text-error" onclick={() => viewModel.logout()}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        {t.logout()}
      </button>
    </li>
  </ul>
</BaseViewModelContainer>
