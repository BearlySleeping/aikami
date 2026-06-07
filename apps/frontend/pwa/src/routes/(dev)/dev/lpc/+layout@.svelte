<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/lpc/+layout@.svelte
  // Reset layout — the LPC page renders outside the dev drawer.
  // The `@` suffix breaks out of all parent layouts.
  const { children } = $props();
</script>

{@render children()}
