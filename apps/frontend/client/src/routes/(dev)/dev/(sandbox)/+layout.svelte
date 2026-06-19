<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/(sandbox)/+layout.svelte
  import ModeIndicator from '$lib/components/mode_indicator.svelte';

  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

{@render children()}

<ModeIndicator />
