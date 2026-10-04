<script lang="ts">
// apps/frontend/client/src/browser_tests/fixtures/pause_menu_harness.svelte
//
// Mounts the real Pause Menu View against a feature-owned ViewModel so the
// keyboard lane exercises compiled markup, not a re-implementation.

import PauseMenuView from '../../lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte';
import type { PauseMenuViewModelInterface } from '../../lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';

type Props = {
  viewModel: PauseMenuViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<PauseMenuView {viewModel} />
