<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/lpc/component-lite/+layout@.svelte
  // Reset layout — this route has zero UI chrome.
  // The `@` suffix breaks out of all parent layouts.
  const { children } = $props();
</script>

{@render children()}
