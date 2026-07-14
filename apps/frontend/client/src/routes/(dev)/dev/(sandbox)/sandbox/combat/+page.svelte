<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/sandbox/combat/+page.svelte
//
// Isolated Combat Encounter sandbox route.
// Mounts a GameWorld with a combat test map containing a slime enemy.
// Walking into the enemy triggers the CombatViewModel overlay.
//
// Contract: C-144 Task 5

import CombatSandboxView from '$lib/views/dev/sandbox/combat/combat_sandbox_view.svelte';
import { getCombatSandboxViewModel } from '$lib/views/dev/sandbox/combat/combat_sandbox_view_model.svelte.ts';

const viewModel = getCombatSandboxViewModel({
  className: 'CombatSandboxViewModel',
});
</script>

<svelte:head>
  <title>Combat Sandbox — Aikami Dev</title>
</svelte:head>

<CombatSandboxView {viewModel} />
