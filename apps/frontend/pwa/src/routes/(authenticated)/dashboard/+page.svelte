<script lang="ts">
import DashboardView from '$views/dashboard/DashboardView.svelte';
import { getDashboardViewModel } from '$views/dashboard/dashboard-view-model.svelte.ts';

const viewModel = getDashboardViewModel({
  className: 'DashboardViewModel',
});
</script>

<DashboardView {viewModel} />
