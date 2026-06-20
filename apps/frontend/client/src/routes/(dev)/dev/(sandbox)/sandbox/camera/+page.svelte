<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/camera/+page.svelte
  //
  // Isolated Camera & Spatial UI sandbox route.
  // Mounts a GameWorld with a tilemap for testing cinematic camera zoom
  // and spatial speech bubble positioning.
  //
  // Contract: C-161 Spatial UI Camera — devtool sandbox

  import CameraSandboxView from '$lib/views/dev/sandbox/camera/camera_sandbox_view.svelte';
  import { getCameraSandboxViewModel } from '$lib/views/dev/sandbox/camera/camera_sandbox_view_model.svelte.ts';

  const viewModel = getCameraSandboxViewModel({
    className: 'CameraSandboxViewModel',
  });
</script>

<CameraSandboxView {viewModel} />
