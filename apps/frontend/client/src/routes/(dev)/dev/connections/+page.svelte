<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/connections/+page.svelte
  import ConnectionsListView from '$views/settings/connection/connections_list_view.svelte';

  // The ConnectionsListView uses its own ViewModel with default factory
</script>

<svelte:head>
  <title>Connection Manager — Dev Sandbox</title>
</svelte:head>

<div class="min-h-full bg-[#0b1326] text-[#dae2fd]">
  <div class="max-w-4xl mx-auto px-6 py-8">
    <ConnectionsListView />
  </div>
</div>
