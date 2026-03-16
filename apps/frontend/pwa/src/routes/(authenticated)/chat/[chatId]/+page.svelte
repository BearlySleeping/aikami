<script lang="ts">
  import ChatView from '$views/chat/ChatView.svelte';
  import { getChatViewModel } from '$views/chat/chat-view-model.svelte.ts';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const viewModel = getChatViewModel({
    className: 'ChatViewModel',
    // svelte-ignore state_referenced_locally
    chatId: data.chatId,
  });
</script>

<ChatView {viewModel} />
