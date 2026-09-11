<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/cyoa/+page.svelte
//
// Dev sandbox for C-245 CYOA Choices Branching Narrative.
//
// Contract: C-245

import { getCyoaSandboxViewModel } from '$views/chat/cyoa_sandbox_composition.ts';
import CyoaSandboxView from '$views/chat/cyoa_sandbox_view.svelte';

const viewModel = getCyoaSandboxViewModel({
  className: 'CyoaSandboxViewModel',
});
</script>

<CyoaSandboxView {viewModel} />
