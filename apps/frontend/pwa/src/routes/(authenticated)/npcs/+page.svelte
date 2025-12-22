<script lang="ts">
    import NpcListView from "$lib/views/npc/list/NpcListView.svelte";
    import { getNpcListViewModel } from "$lib/views/npc/list/npc-list-view-model.svelte";

    const viewModel = getNpcListViewModel({ className: "NpcListViewModel" });
</script>

<NpcListView {viewModel} />
