<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/layout/layout_index_page.dev.svelte
  import { NAV_ITEMS } from './layout_view_model.dev.svelte.ts';
</script>

<div class="p-6">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-primary">Aikami Dev Console</h1>
    <div class="mt-2 flex flex-wrap gap-3 text-sm">
      <span class="badge badge-primary">v0.1.0</span>
      <span class="badge badge-outline">client</span>
      <span class="badge badge-outline">emulator</span>
    </div>
    <p class="mt-4 text-base-content/60">
      Isolated frontend sandboxes for testing individual microservices.
    </p>
  </div>

  <!-- Nav grid -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
    {#each NAV_ITEMS as item}
      <a
        href={item.route}
        class="btn btn-outline flex h-auto flex-col items-center gap-2 p-4 text-base-content hover:btn-primary"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon} />
        </svg>
        <span class="text-sm font-medium">{item.label}</span>
      </a>
    {/each}
  </div>
</div>
