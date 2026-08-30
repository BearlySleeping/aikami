<script lang="ts">
// apps/frontend/client/src/lib/views/setup/setup_view.svelte
//
// Setup route view — hosts the onboarding coordinator (persona creation).
// C-405: the world-generation wizard no longer lives on this route; it moved
// to the Advanced entry at /worldgen.
import { BaseViewModelContainer } from '$components';
import OnboardingCoordinatorView from '$views/onboarding/onboarding_coordinator_view.svelte';
import type { SetupViewModelInterface } from './setup_view_model.svelte';

let { viewModel }: { viewModel: SetupViewModelInterface } = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <OnboardingCoordinatorView viewModel={viewModel.onboardingViewModel} />
</BaseViewModelContainer>
