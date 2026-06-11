<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/layout/dev_layout_view.svelte
  import type { Snippet } from 'svelte';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { DevViewModelInterface } from './dev_layout_view_model.svelte.ts';

  type Props = {
    viewModel: DevViewModelInterface;
    children: Snippet;
  };

  let { viewModel, children }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="drawer lg:drawer-open">
  <input
    id="dev-drawer"
    type="checkbox"
    class="drawer-toggle"
    checked={viewModel.isDrawerOpen}
    onchange={() => viewModel.toggleDrawer()}
  >

  <div class="drawer-content flex flex-col min-h-screen">
    <!-- Top bar with drawer toggle -->
    <header class="flex items-center gap-2 bg-base-200 px-4 py-2 shadow-sm">
      <label for="dev-drawer" class="btn btn-ghost drawer-button lg:hidden">
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
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </label>
      <span class="text-sm font-semibold text-base-content/70">Dev Console</span>
    </header>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>

  <!-- Navigation drawer -->
  <div class="drawer-side">
    <label for="dev-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
    <aside class="bg-base-200 text-base-content min-h-full w-56 p-4">
      <h2 class="mb-4 text-lg font-bold">Dev Console</h2>

      <ul class="menu gap-1">
        {#each viewModel.navItems as item}
          <li>
            <a href={item.route} class:active={viewModel.activeRoute === item.route}>
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
                  d={item.icon}
                />
              </svg>
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </aside>
  </div>
</BaseViewModelContainer>
