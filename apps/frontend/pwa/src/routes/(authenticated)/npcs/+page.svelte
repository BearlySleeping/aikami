<script lang="ts">
  import NpcListView from '$views/npc/list/npc_list_view.svelte';
  import { getNpcListViewModel } from '$views/npc/list/npc_list_view_model.svelte';

  const viewModel = getNpcListViewModel({ className: 'NpcListViewModel' });
</script>

<NpcListView {viewModel} />
