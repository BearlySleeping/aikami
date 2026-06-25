<script lang="ts">
  // apps/frontend/client/src/lib/views/app/bar/AppBar.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import { getAppBarViewModel } from './app_bar_view_model.svelte.ts';

  const viewModel = getAppBarViewModel({ className: 'AppBarViewModel' });
</script>

<BaseViewModelContainer {viewModel} class="navbar bg-base-100 shadow-sm">
  <div class="navbar-start">
    {#if viewModel.showDrawerButton && viewModel.isLoggedIn}
      <label
        for="left-drawer"
        class="btn btn-ghost btn-circle lg:hidden"
        data-testid="drawer-toggle"
        aria-label="Open navigation menu"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </label>
    {/if}

    <!-- Logo/Brand -->
    <button class="btn btn-ghost text-xl font-bold" onclick={() => viewModel.goToHome()}>
      {t.app_name()}
    </button>
  </div>

  <div class="navbar-center">
    {#if viewModel.appBarTitle}
      <h1 class="text-lg font-semibold">{viewModel.appBarTitle}</h1>
    {/if}
  </div>

  <div class="navbar-end">
    {#if viewModel.isLoggedIn}
      <!-- User menu dropdown -->
      <div class="dropdown dropdown-end">
        <button class="btn btn-ghost btn-circle avatar">
          <div class="w-10 rounded-full bg-base-300 flex items-center justify-center">
            {#if viewModel.currentUser?.photoURL}
              <img
                src={viewModel.currentUser.photoURL}
                alt={t.profile_picture()}
                class="w-full h-full rounded-full object-cover"
              >
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            {/if}
          </div>
        </button>
        <ul class="menu dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
          {#each viewModel.profileMenuOptions as option (option.text)}
            <li>
              <button onclick={() => option.click()}>
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
                    d={option.icon}
                  />
                </svg>
                {option.text}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <!-- Login/Register buttons for unauthenticated users -->
      <div class="flex gap-2">
        <button class="btn btn-ghost" onclick={() => viewModel.goToLogin()}>{t.login()}</button>
        <button class="btn btn-primary" onclick={() => viewModel.goToRegister()}>
          {t.register()}
        </button>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
