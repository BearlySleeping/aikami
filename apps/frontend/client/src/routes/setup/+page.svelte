<script lang="ts">
// apps/frontend/client/src/routes/setup/+page.svelte
//
// Session Zero setup route — entry point for new games.
//
// Normal flow: WorldGenWizardView (6 steps) → PersonaCreateView
// Bypass: ?skip-wizard=true → PersonaCreateView directly
//
// Contract: C-233 World Generation Wizard

import type { WorldGenOutput } from '@aikami/types';
import { page } from '$app/stores';
import { gameStateService } from '$services';
import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';
import WorldGenWizardView from '$views/worldgen/world_gen_wizard_view.svelte';
import { getWorldGenWizardViewModel } from '$views/worldgen/world_gen_wizard_view_model.svelte';

// ── Query param check ──

/** Whether to bypass the world-gen wizard and go straight to character creation. */
let skipWizard = $state(false);

// Read URL search params
$effect(() => {
  const url = $page.url;
  skipWizard = url.searchParams.get('skip-wizard') === 'true';
});

// ── World Gen Wizard ViewModel ──

/**
 * Called when the user accepts the generated world in the wizard.
 * Seeds NPCs/locations/arcs/widgets into game state, persists the
 * WorldGenOutput, then switches to character creation view.
 */
const onWorldAccepted = async (output: WorldGenOutput): Promise<void> => {
  // Persist world-gen output in GameStateService
  gameStateService.setWorldGenOutput(output);

  // Skip the wizard on subsequent visits after world is accepted
  skipWizard = true;
};

const wizardViewModel = getWorldGenWizardViewModel({
  className: 'WorldGenWizardViewModel',
  onWorldAccepted,
});

// ── Persona Create ViewModel (for direct access or after wizard) ──

const personaViewModel = getPersonaCreateViewModel({
  className: 'PersonaCreateViewModel',
});
</script>

{#if skipWizard}
  <PersonaCreateView viewModel={personaViewModel} />
{:else}
  <WorldGenWizardView viewModel={wizardViewModel} />
{/if}
