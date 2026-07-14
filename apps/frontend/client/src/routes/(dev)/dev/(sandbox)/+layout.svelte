<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/+layout.svelte
import { BaseDevViewModel } from '@aikami/frontend/services';
import ModeIndicator from '$lib/components/mode_indicator.svelte';

import type { LayoutProps } from './$types';

let { children }: LayoutProps = $props();

const isScreenshot = $state(BaseDevViewModel.isScreenshot());
</script>

{@render children()}

{#if !isScreenshot}
  <ModeIndicator />
{/if}
