<script lang="ts">
// apps/frontend/client/src/routes/capability/+page.svelte
//
// Capability route — entry point for AI setup. Presents three paths:
// Recommended, Connect existing, Text-only. Uses the shared setup subflow.
//
// `?reason=text-provider-required` marks entry from the New Adventure
// gate — completion resumes campaign creation. `?from=settings` marks
// entry from Settings — completion returns there instead. Bookmarking or
// dev navigation with neither param defaults to 'direct'.
// Contract: C-483 AC-1

import { page } from '$app/state';
import SetupEntryView from '$views/setup_subflow/setup_entry_view.svelte';
import {
  getSetupEntryViewModel,
  type SetupEntryViewModelOptions,
} from '$views/setup_subflow/setup_entry_view_model.svelte';

const resolveOrigin = (): SetupEntryViewModelOptions['origin'] => {
  if (page.url.searchParams.get('from') === 'settings') {
    return 'settings';
  }
  if (page.url.searchParams.get('reason') === 'text-provider-required') {
    return 'new-adventure';
  }
  return 'direct';
};

const viewModel = getSetupEntryViewModel({
  className: 'SetupEntryViewModel',
  origin: resolveOrigin(),
});
</script>

<SetupEntryView {viewModel} />
