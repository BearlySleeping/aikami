<script lang="ts">
  // apps/frontend/pwa/src/routes/(authenticated)/chat/[chatId]/+page.svelte
  import { page } from '$app/state';
  import ChatView from '$views/chat/chat_view.svelte';
  import { getChatViewModel } from '$views/chat/chat_view_model.svelte';

  // svelte-ignore state_referenced_locally
  const viewModel = getChatViewModel({
    className: 'ChatViewModel',
    chatId: page.params.chatId,
    npcId: page.url.searchParams.get('npcId') ?? undefined,
  });
</script>

<ChatView {viewModel} />
