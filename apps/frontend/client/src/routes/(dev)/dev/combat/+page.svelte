<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/combat/+page.svelte
//
// Canonical combat debug workspace route. All three modes (live, replay,
// fixtures) live behind this one URL; the mode is URL configuration, not a
// separate page. `/dev/combat-enhancements` and `/dev/sandbox/combat` redirect
// here (see their +page.ts redirects).

import { getCombatDebugViewModel } from '$views/dev/combat/combat_debug_composition.ts';
import CombatDebugView from '$views/dev/combat/combat_debug_view.svelte';

const viewModel = getCombatDebugViewModel({
  className: 'CombatDebugViewModel',
});
</script>

<svelte:head>
  <title>Combat Debug Workspace — Aikami Dev</title>
</svelte:head>

<CombatDebugView {viewModel} />
