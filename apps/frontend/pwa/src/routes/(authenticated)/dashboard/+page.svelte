<script lang="ts">
import { getDashboardViewModel } from '$lib/views/dashboard/dashboard-view-model.svelte.ts';

const _viewModel = getDashboardViewModel({
  className: 'DashboardViewModel',
});
</script>

<DashboardView {viewModel} />
