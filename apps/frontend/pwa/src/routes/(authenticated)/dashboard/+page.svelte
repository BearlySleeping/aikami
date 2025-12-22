<script lang="ts">
    import DashboardView from "$lib/views/dashboard/DashboardView.svelte";
    import { getDashboardViewModel } from "$lib/views/dashboard/dashboard-view-model.svelte";

    const viewModel = getDashboardViewModel({
        className: "DashboardViewModel",
    });
</script>

<DashboardView {viewModel} />
