<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/combat-enhancements/+page.svelte

import CombatEnhancementsView from '$views/dev/combat_enhancements/combat_enhancements_view.svelte';
import { createCombatEnhancementsViewModel } from '$views/dev/combat_enhancements/combat_enhancements_view_model.svelte.ts';

const viewModel = createCombatEnhancementsViewModel({
  className: 'CombatEnhancementsViewModel',
});
</script>

<CombatEnhancementsView {viewModel} />
