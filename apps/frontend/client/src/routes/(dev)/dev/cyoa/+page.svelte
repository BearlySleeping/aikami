<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/cyoa/+page.svelte
//
// Dev sandbox for C-245 CYOA Choices Branching Narrative.
//
// Contract: C-245

import CyoaSandboxView from '$views/chat/cyoa_sandbox_view.svelte';
import { getCyoaSandboxViewModel } from '$views/chat/cyoa_sandbox_view_model.svelte.ts';

const viewModel = getCyoaSandboxViewModel({
  className: 'CyoaSandboxViewModel',
});
</script>

<CyoaSandboxView {viewModel} />
