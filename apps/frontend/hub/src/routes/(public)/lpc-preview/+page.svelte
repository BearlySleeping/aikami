<script lang="ts">
// apps/frontend/hub/src/routes/(public)/lpc-preview/+page.svelte
// LPC preview index: client-only route that mounts the character compositor.

import LpcPreviewView from '$views/lpc_preview/lpc_preview_view.svelte';
import { getHubLpcPreviewViewModel } from '$views/lpc_preview/lpc_preview_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const viewModel = $derived(
  getHubLpcPreviewViewModel({ data, className: 'HubLpcPreviewViewModel' }),
);
</script>

<LpcPreviewView {viewModel} />
