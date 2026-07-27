<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/lpc-walk/+page.svelte
//
// Dev sandbox — isolated LPC walk animation tester.
// WASD-driven character movement with live animation debug overlay.
// Designed to diagnose the "gliding" bug where walk animation
// freezes while the character moves.

import LpcWalkTestView from '$views/dev/lpc_walk/lpc_walk_test_view.svelte';
import { getLpcWalkTestViewModel } from '$views/dev/lpc_walk/lpc_walk_test_view_model.svelte';

const viewModel = getLpcWalkTestViewModel({
  className: 'LpcWalkTestViewModel',
});
</script>

<LpcWalkTestView {viewModel} />
