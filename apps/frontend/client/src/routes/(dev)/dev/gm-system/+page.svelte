<script lang="ts">
import { getGmSystemSandboxViewModel } from '$views/gm/gm_system_sandbox_composition.ts';
// apps/frontend/client/src/routes/(dev)/dev/gm-system/+page.svelte
import GmSystemSandboxView from '$views/gm/gm_system_sandbox_view.svelte';

const viewModel = getGmSystemSandboxViewModel({ className: 'GmSystemSandboxViewModel' });
</script>

<GmSystemSandboxView {viewModel} />
