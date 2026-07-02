<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/chat/+page.svelte
  //
  // Sandbox route for ChatViewModel + DevTools
  // NEVER import production ViewModels or services here.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import ChatView from '$views/chat/chat_view.svelte';
  import { getChatDevViewModel } from '$views/chat/chat_view_model.dev.svelte.ts';

  const viewModel = getChatDevViewModel({
    className: 'ChatDevViewModel',
    chatId: 'dev-chat-mock',
  });

  /** Dev tools actions wired to ChatDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Simulate Bot Reply',
      onClick: () => viewModel.simulateBotReply(),
    },
    {
      label: 'Trigger Network Error',
      onClick: () => viewModel.triggerNetworkError(),
    },
  ];

  /** Dev tools toggles wired to ChatDevViewModel sandbox state. */
  const devToggles = [
    {
      label: 'Simulate Latency (2s delay)',
      onChange: (checked: boolean) => (viewModel.simulateLatency = checked),
    },
  ];
</script>

<ChatView {viewModel} />

<DevToolsPanel actions={devActions} toggles={devToggles} />
