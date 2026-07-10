<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/connected-chats/+page.svelte
  //
  // Dev sandbox route for the connected chats bridge (C-244).
  // Demonstrates tag parsing, OOC cross-posting, and link management UI.
  import ConnectedChatsSandboxView from '$views/chat/connected_chats_sandbox_view.svelte';
  import { getConnectedChatsSandboxViewModel } from '$views/chat/connected_chats_sandbox_view_model.svelte.ts';

  const viewModel = getConnectedChatsSandboxViewModel({
    className: 'ConnectedChatsSandboxViewModel',
  });
</script>

<svelte:head>
  <title>Connected Chats Bridge — Dev Sandbox</title>
</svelte:head>

<ConnectedChatsSandboxView {viewModel} />
