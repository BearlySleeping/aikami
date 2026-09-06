<script lang="ts">
// apps/frontend/client/src/lib/views/setup_subflow/setup_entry_view.svelte
//
// Entry view for the capability route — delegates to the shared
// setup subflow view with the three entry paths.
// Contract: C-483 AC-1

import { BaseViewModelContainer } from '$components';
import type { SetupEntryViewModelInterface } from './setup_entry_view_model.svelte';
import SetupSubflowView from './setup_subflow_view.svelte';

type Props = {
  viewModel: SetupEntryViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <SetupSubflowView viewModel={viewModel.subflow} />
</BaseViewModelContainer>
