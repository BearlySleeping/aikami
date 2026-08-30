<script lang="ts">
// apps/frontend/hub/src/routes/(public)/sandbox/[mapTag]/+page.svelte
// Walk sandbox page (C-447): client-only route that mounts WalkSandbox.

import WalkSandboxView from '$views/sandbox/walk_sandbox_view.svelte';
import { getWalkSandboxViewModel } from '$views/sandbox/walk_sandbox_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// Create the ViewModel once per data change ($derived re-evaluates only when deps change)
const viewModel = $derived(getWalkSandboxViewModel({ data, className: 'HubWalkSandboxViewModel' }));
</script>

<WalkSandboxView {viewModel} />
