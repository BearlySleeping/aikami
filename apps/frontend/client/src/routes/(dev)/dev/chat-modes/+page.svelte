<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/chat-modes/+page.svelte
import ChatModesSandboxView from '$views/chat/chat_modes_sandbox_view.svelte';
import { getChatModesSandboxViewModel } from '$views/chat/chat_modes_sandbox_view_model.svelte.ts';

const viewModel = getChatModesSandboxViewModel({
  className: 'ChatModesSandboxViewModel',
  chatId: 'dev-chat-modes',
});
</script>

<svelte:head>
  <title>Chat Modes — Dev Sandbox</title>
</svelte:head>

<ChatModesSandboxView {viewModel} />
