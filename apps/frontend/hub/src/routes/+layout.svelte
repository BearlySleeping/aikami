<script lang="ts">
// apps/frontend/hub/src/routes/+layout.svelte
import '../app.css';
import { onMount } from 'svelte';
import AppView from '$views/app/app_view.svelte';
import { getAppViewModel } from '$views/app/app_view_model.svelte';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

// svelte-ignore state_referenced_locally
const viewModel = getAppViewModel({ data, className: 'AppViewModel' });

// Signal SSR hydration completion to the E2E runner (C-030 AC-1).
// The Playwright layer suspends until [data-hydrated="true"] appears on the
// document element, ensuring event handlers are bound before interactions.
onMount(() => {
  document.documentElement.setAttribute('data-hydrated', 'true');
});
</script>

<AppView {viewModel}> {@render children()} </AppView>
