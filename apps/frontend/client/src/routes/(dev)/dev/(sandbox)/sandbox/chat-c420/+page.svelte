<script lang="ts">
import { getChatC420SandboxViewModel } from '$views/chat/chat_c420_sandbox_view_model.svelte.ts';
// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/chat-c420/+page.svelte
//
// C-420 verification sandbox — mounts the PRODUCTION ChatView with an empty
// chat so the starter-chip empty state (AC-2) and model-chip-after-turn
// behaviour (AC-3) can be exercised and screenshotted. Dev-only.
import ChatView from '$views/chat/chat_view.svelte';

const viewModel = getChatC420SandboxViewModel({
  className: 'ChatC420SandboxVM',
  chatId: 'c420-sandbox',
});
</script>

<svelte:head>
  <title>Chat C-420 — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 bg-base-100 p-4">
  <ChatView {viewModel} />
</div>
