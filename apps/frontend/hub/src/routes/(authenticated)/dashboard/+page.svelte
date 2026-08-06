<script lang="ts">
// apps/frontend/hub/src/routes/(authenticated)/dashboard/+page.svelte
import DashboardView from '$lib/views/dashboard/dashboard_view.svelte';
import { getDashboardViewModel } from '$lib/views/dashboard/dashboard_view_model.svelte.ts';

const viewModel = getDashboardViewModel({ className: 'DashboardViewModel' });
</script>

<DashboardView {viewModel} />
