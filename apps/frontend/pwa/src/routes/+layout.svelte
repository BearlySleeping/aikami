<script lang="ts">
import '../app.css';
import { onMount } from 'svelte';
import AppView from '$lib/views/app/AppView.svelte';
import logger from '$logger/index.ts';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

// svelte-ignore state_referenced_locally
const { logLevel } = data;
if (logLevel) {
  logger.setLogLevel(logLevel);
}

onMount(async () => {
  if (import.meta.env.PUBLIC_FLAVOR === 'development') {
    const eruda = (await import('eruda')).default;
    eruda.init();
  }
});
</script>

<AppView {data}>
    {@render children()}
</AppView>
