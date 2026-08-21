<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/chat-c424/+page.svelte
//
// C-424 verification sandbox — mounts the PRODUCTION ChatView with the dev
// ViewModel so the shared RichMessageList / GuidedComposer chat surface can
// be exercised and screenshotted. Dev-only; never imported from production.
import ChatView from '$views/chat/chat_view.svelte';
import { getChatDevViewModel } from '$views/chat/chat_view_model.dev.svelte.ts';

const viewModel = getChatDevViewModel({
  className: 'ChatC424SandboxVM',
  chatId: 'c424-sandbox',
});
</script>

<svelte:head>
  <title>Chat C-424 — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 bg-base-100 p-4">
  <ChatView {viewModel} />
</div>
