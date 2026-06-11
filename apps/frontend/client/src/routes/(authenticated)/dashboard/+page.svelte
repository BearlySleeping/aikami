<script lang="ts">
  import DashboardView from '$views/dashboard/dashboard_view.svelte';
  import { getDashboardViewModel } from '$views/dashboard/dashboard_view_model.svelte';

  const viewModel = getDashboardViewModel({
    className: 'DashboardViewModel',
  });
</script>

<DashboardView {viewModel} />
