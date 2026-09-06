<script lang="ts">
// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view.svelte
//
// Shared setup subflow view — renders the guided AI setup flow based on
// the current step. Used by the capability route and the guided setup route.
// Contract: C-483

import { BaseViewModelContainer } from '$components';
import SetupSubflowContent from './setup_subflow_content.svelte';
import type { SetupSubflowViewModelInterface } from './setup_subflow_view_model.svelte';

type Props = {
  viewModel: SetupSubflowViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
    <div class="card bg-base-100 w-full max-w-lg shadow-xl">
      <div class="card-body gap-4">
        <!-- Header -->
        <div class="text-center">
          <h1 class="text-2xl font-bold text-base-content">AI Setup</h1>
          <p class="mt-1 text-sm text-base-content/60">Configure AI capabilities for your game</p>
        </div>

        <SetupSubflowContent
          step={viewModel.step}
          capabilityToggles={viewModel.capabilityToggles}
          discoveredProviders={viewModel.discoveredProviders}
          hasDiscoveredProviders={viewModel.hasDiscoveredProviders}
          resourceWarnings={viewModel.resourceWarnings}
          hasResourceWarnings={viewModel.hasResourceWarnings}
          isDetecting={viewModel.isDetecting}
          isApplying={viewModel.isApplying}
          errorMessage={viewModel.displayErrorMessage}
          onSelectEntryPath={(path) => viewModel.selectEntryPath(path)}
          onToggleCapability={(capability) => viewModel.toggleCapability(capability)}
          onStartDiscovery={() => viewModel.startDiscovery()}
          onApplyPlan={() => viewModel.applyPlan()}
          onGoBack={() => viewModel.goBack()}
          onLeave={() => viewModel.leave()}
          onReset={() => viewModel.reset()}
          onRetry={() => viewModel.retry()}
        />
      </div>
    </div>
  </div>
</BaseViewModelContainer>
