<script lang="ts">
  // apps/frontend/client/src/routes/+page.svelte

  import StartView from '$views/start/start_view.svelte';
  import { getStartViewModel } from '$views/start/start_view_model.svelte';

  const viewModel = getStartViewModel({
    className: 'StartViewModel',
  });
</script>

<StartView {viewModel} />
