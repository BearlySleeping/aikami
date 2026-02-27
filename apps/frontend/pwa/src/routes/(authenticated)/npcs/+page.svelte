<script lang="ts">
import { getNpcListViewModel } from '$lib/views/npc/list/npc-list-view-model.svelte.ts';

const _viewModel = getNpcListViewModel({ className: 'NpcListViewModel' });
</script>

<NpcListView {viewModel} />
