<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/text/+page.svelte
  import TextView from '$views/dev/text/text_view.svelte';
  import { getTextViewModel } from '$views/dev/text/text_view_model.svelte';

  const viewModel = getTextViewModel({
    className: 'TextViewModel',
  });
</script>

<TextView {viewModel} />
