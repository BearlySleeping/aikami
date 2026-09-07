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
        <!-- Header — names the step, so no two screens read the same -->
        <div class="text-center">
          <h1 class="text-2xl font-bold text-base-content">{viewModel.headingTitle}</h1>
          {#if viewModel.hasHeadingSubtitle}
            <p class="mt-1 text-sm text-base-content/60">{viewModel.headingSubtitle}</p>
          {/if}
        </div>

        <SetupSubflowContent {viewModel} />
      </div>
    </div>
  </div>
</BaseViewModelContainer>
