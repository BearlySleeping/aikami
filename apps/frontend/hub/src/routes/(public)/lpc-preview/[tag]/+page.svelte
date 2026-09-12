<script lang="ts">
// apps/frontend/hub/src/routes/(public)/lpc-preview/[tag]/+page.svelte
// LPC preview asset: client-only route that mounts the character compositor
// with the requested catalog component already applied.

import LpcPreviewView from '$views/lpc_preview/lpc_preview_view.svelte';
import { getHubLpcPreviewViewModel } from '$views/lpc_preview/lpc_preview_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const viewModel = $derived(
  getHubLpcPreviewViewModel({ data, className: 'HubLpcPreviewViewModel' }),
);
</script>

{#key data.entry?.tag}
  <LpcPreviewView {viewModel} />
{/key}
