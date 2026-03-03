<script lang="ts">
import GroupChatView from '$views/group-chat/chat/GroupChatView.svelte';
import { getGroupChatViewModel } from '$views/group-chat/chat/group-chat-view-model.svelte.ts';

import type { PageProps } from './$types';

let { data }: PageProps = $props();

// svelte-ignore state_referenced_locally
const viewModel = getGroupChatViewModel({
  className: 'GroupChatViewModel',
  groupChatId: data.id,
});
</script>

<GroupChatView {viewModel} />
