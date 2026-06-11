<script lang="ts">
  // apps/frontend/client/src/routes/+layout.svelte
  import '../app.css';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

{@render children()}
