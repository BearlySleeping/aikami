<script lang="ts">
// apps/frontend/hub/src/routes/(public)/studio/assets/+page.svelte
// C-522 — Studio → Generation: mounts the pairing/dispatch/review surface.

import { createGenerationRunnerClient } from '$lib/client/services/generation_runner_client.ts';
import StudioAssetsView from '$lib/views/studio_assets/studio_assets_view.svelte';
import { createHubStudioAssetsViewModel } from '$lib/views/studio_assets/studio_assets_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// One ViewModel per data change: re-deriving is what picks up a fresh session
// state after a sign-in without remounting the route.
const viewModel = $derived(
  createHubStudioAssetsViewModel({
    className: 'HubStudioAssetsViewModel',
    signedIn: data.signedIn,
    configured: data.configured,
    devices: data.devices,
    client: createGenerationRunnerClient('/api'),
  }),
);

$effect(() => {
  // The server already supplied the device list; the rest of the surface (the
  // availability reason, dispatches and candidates) is session-scoped and only
  // exists once we are signed in.
  void viewModel.refresh();
});
</script>

<StudioAssetsView {viewModel} />
