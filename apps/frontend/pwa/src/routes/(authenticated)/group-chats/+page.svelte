<script lang="ts">
  import GroupChatListView from '$views/group-chat/list/GroupChatListView.svelte';
  import { getGroupChatListViewModel } from '$views/group-chat/list/group-chat-list-view-model.svelte.ts';

  const viewModel = getGroupChatListViewModel({
    className: 'GroupChatListViewModel',
  });
</script>

<GroupChatListView {viewModel} />
