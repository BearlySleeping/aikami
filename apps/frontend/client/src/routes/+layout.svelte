<script lang="ts">
  // apps/frontend/client/src/routes/+layout.svelte
  import '../app.css';
  import AppShell from '$lib/views/app/app_view.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<AppShell {data}> {@render children()} </AppShell>
