<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/sandbox/+page.svelte
  import SandboxView from '$views/dev/sandbox/sandbox_view.svelte';
  import { getSandboxViewModel } from '$views/dev/sandbox/sandbox_view_model.svelte';

  const viewModel = getSandboxViewModel({
    className: 'SandboxViewModel',
  });
</script>

<SandboxView {viewModel} />
