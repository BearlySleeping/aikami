<script lang="ts">
  import NpcListView from '$views/npc/list/NpcListView.svelte';
  import { getNpcListViewModel } from '$views/npc/list/npc-list-view-model.svelte.ts';

  const viewModel = getNpcListViewModel({ className: 'NpcListViewModel' });
</script>

<NpcListView {viewModel} />
