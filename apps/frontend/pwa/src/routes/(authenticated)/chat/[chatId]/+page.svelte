<script lang="ts">
  // apps/frontend/pwa/src/routes/(authenticated)/chat/[chatId]/+page.svelte
  import ChatView from '$views/chat/ChatView.svelte';
  import { getChatViewModel } from '$views/chat/chat-view-model.svelte.ts';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // svelte-ignore state_referenced_locally
  const viewModel = getChatViewModel({
    className: 'ChatViewModel',
    chat: data.chat,
    npc: data.npc,
  });
</script>

<ChatView {viewModel} />
