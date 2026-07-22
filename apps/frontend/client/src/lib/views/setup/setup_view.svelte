<script lang="ts">
// apps/frontend/client/src/lib/views/setup/setup_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
import WorldGenWizardView from '$views/worldgen/world_gen_wizard_view.svelte';
import type { SetupViewModelInterface } from './setup_view_model.svelte';

let { viewModel }: { viewModel: SetupViewModelInterface } = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.skipWizard}
    <PersonaCreateView viewModel={viewModel.personaViewModel} />
  {:else}
    <WorldGenWizardView viewModel={viewModel.wizardViewModel} />
  {/if}
</BaseViewModelContainer>
