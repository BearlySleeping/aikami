<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/lpc-ai/+page.svelte
//
// Dev sandbox — test AI-generated LPC recipes in isolation.
// Paste the lpcRecipe JSON from AI character extraction and get
// instant visual feedback with per-slot diagnostics.

import LpcAiTestView from '$views/dev/lpc_ai/lpc_ai_test_view.svelte';
import { getLpcAiTestViewModel } from '$views/dev/lpc_ai/lpc_ai_test_view_model.svelte';

const viewModel = getLpcAiTestViewModel({
  className: 'LpcAiTestViewModel',
});
</script>

<LpcAiTestView {viewModel} />
