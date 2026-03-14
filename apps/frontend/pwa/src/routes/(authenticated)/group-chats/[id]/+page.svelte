<script lang="ts">
  import { page } from '$app/state';
  import GroupChatView from '$views/group-chat/chat/GroupChatView.svelte';
  import { getGroupChatViewModel } from '$views/group-chat/chat/group-chat-view-model.svelte.ts';

  // svelte-ignore state_referenced_locally
  const viewModel = getGroupChatViewModel({
    className: 'GroupChatViewModel',
    groupChatId: page.params.id,
  });
</script>

<GroupChatView {viewModel} />
