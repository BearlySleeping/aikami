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
  <input id="my-drawer-4" type="checkbox" class="drawer-toggle">
  <div class="drawer-content">
    <!-- Navbar -->
    <nav class="navbar w-full bg-base-300">
      <label for="my-drawer-4" aria-label="open sidebar" class="btn btn-square btn-ghost">
        <!-- Sidebar toggle icon -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          stroke-linejoin="round"
          stroke-linecap="round"
          stroke-width="2"
          fill="none"
          stroke="currentColor"
          class="my-1.5 inline-block size-4"
        >
          <path
            d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"
          ></path>
          <path d="M9 4v16"></path>
          <path d="M14 10l2 2l-2 2"></path>
        </svg>
      </label>
      <a href="/dev" class="px-4">Dev Console</a>
    </nav>

    <div class="p-4">
      <main class="flex-1 overflow-y-auto">
        {@render children()}
      </main>
    </div>
  </div>

  <div class="drawer-side is-drawer-close:overflow-visible">
    <label for="my-drawer-4" aria-label="close sidebar" class="drawer-overlay"></label>
    <div
      class="flex min-h-full flex-col items-start bg-base-200 is-drawer-close:w-14 is-drawer-open:w-64"
    >
      <!-- Sidebar content here -->
      <ul class="menu w-full grow">
        {#each viewModel.navItems as item}
          <li>
            <a
              href={item.route}
              class:active={viewModel.activeRoute === item.route}
              class="is-drawer-close:tooltip is-drawer-close:tooltip-right"
              data-tip={item.label}
            >
              <!-- Home icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-width="2"
                fill="none"
                stroke="currentColor"
                class="my-1.5 inline-block size-4"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d={item.icon}
                />
              </svg>
              <span class="is-drawer-close:hidden"> {item.label}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</BaseViewModelContainer>
