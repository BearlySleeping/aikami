<script lang="ts">
// apps/frontend/client/src/browser_tests/fixtures/quest_overlay_harness.svelte
//
// Mounts the real quest-overlay View so the rendered ARIA semantics (not just
// ViewModel getters) are observable in Chromium.

import QuestOverlay from '../../lib/views/game/ui/hud/quest_overlay.svelte';
import type { QuestOverlayViewModelInterface } from '../../lib/views/game/ui/hud/quest_overlay_view_model.svelte';

type Props = {
  viewModel: QuestOverlayViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<QuestOverlay {viewModel} />
