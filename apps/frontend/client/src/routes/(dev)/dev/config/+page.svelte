<script lang="ts">
  import { getDevProvidersViewModel } from '$views/dev/config/providers_view_model.dev.svelte.ts';
  // apps/frontend/client/src/routes/(dev)/dev/config/+page.svelte
  import ProvidersView from '$views/settings/providers/providers_view.svelte';

  const viewModel = getDevProvidersViewModel({
    className: 'DevProvidersViewModel',
  });

  viewModel.initialize();
</script>

<ProvidersView {viewModel} />
