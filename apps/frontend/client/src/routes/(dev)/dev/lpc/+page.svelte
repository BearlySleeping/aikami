<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/lpc/+page.svelte
  import LpcView from '$views/dev/lpc/lpc_view.svelte';
  import { getLpcViewModel } from '$views/dev/lpc/lpc_view_model.svelte';

  const viewModel = getLpcViewModel({
    className: 'LpcViewModel',
  });
</script>

<LpcView {viewModel} />
