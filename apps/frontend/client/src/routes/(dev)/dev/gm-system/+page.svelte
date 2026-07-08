<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/gm-system/+page.svelte
  import GmSystemSandboxView from '$views/gm/gm_system_sandbox_view.svelte';
  import { getGmSystemSandboxViewModel } from '$views/gm/gm_system_sandbox_view_model.svelte.ts';

  const viewModel = getGmSystemSandboxViewModel({ className: 'GmSystemSandboxViewModel' });
</script>

<GmSystemSandboxView {viewModel} />
