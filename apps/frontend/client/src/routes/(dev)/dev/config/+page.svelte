<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/config/+page.svelte
  import ConfigView from '$views/dev/config/config_view.svelte';
  import { getConfigViewModel } from '$views/dev/config/config_view_model.svelte';

  const viewModel = getConfigViewModel({
    className: 'ConfigViewModel',
  });

  viewModel.initialize();
</script>

<ConfigView {viewModel} />
