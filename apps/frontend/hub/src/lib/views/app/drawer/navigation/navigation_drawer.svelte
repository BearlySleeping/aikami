<script lang="ts">
import { BaseViewModelContainer } from '$components';
import { getNavigationDrawerViewModel } from './navigation_drawer_view_model.svelte.ts';

const viewModel = getNavigationDrawerViewModel({ className: 'NavigationDrawerViewModel' });
</script>

<BaseViewModelContainer
  {viewModel}
  class="w-64 shrink-0 border-r border-base-300 bg-base-200 lg:static lg:block"
>
  <div class="flex h-full flex-col p-4">
    {#each viewModel.navigationItems as item (item.route)}
      <button
        type="button"
        class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-base-content transition-colors
          {item.active
            ? 'border-l-[3px] border-primary bg-primary/5 font-medium'
            : 'hover:bg-base-300'}"
        data-testid="nav-{item.route}"
        onclick={() => viewModel.goToRoute(item.route)}
      >
        <svg
          role="img"
          aria-label={item.label}
          class="h-4 w-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
        </svg>
        {item.label}
      </button>
    {/each}

    <div class="mt-auto pt-4 border-t border-base-300">
      {#if viewModel.isLoggedIn}
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-error transition-colors hover:bg-error/5"
          onclick={() => viewModel.logout()}
        >
          <svg
            role="img"
            aria-label="Logout"
            class="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Logout
        </button>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
