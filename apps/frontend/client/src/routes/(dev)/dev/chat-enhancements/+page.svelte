<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/chat-enhancements/+page.svelte
//
// Dev sandbox for C-231 Rich Chat Streaming enhancements.
// Demonstrates: message branching (alternatives/swiping), input drafts,
// inline action bars, auto-resize textarea, and streaming TTS toggle.
//
// Contract: C-231 AC-6 Dev Sandbox

import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
import { getChatEnhancementsSandboxViewModel } from '$views/chat/chat_enhancements_sandbox_view_model.svelte.ts';
import ChatView from '$views/chat/chat_view.svelte';

const viewModel = getChatEnhancementsSandboxViewModel({
  className: 'ChatEnhancementsSandboxViewModel',
  chatId: 'dev-chat-enhancements',
});
</script>

<div class="flex flex-col h-screen p-4">
  <h1 class="text-xl font-bold mb-4">Chat Enhancements Sandbox</h1>
  <p class="text-sm text-base-content/60 mb-4">
    Demonstrates C-231: alternatives/swiping, action bars (hover), auto-resize input, draft
    persistence, streaming TTS toggle.
  </p>
  <div class="flex-1 min-h-0">
    <ChatView {viewModel} />
  </div>
</div>

<DevToolsPanel
  actions={[
    {
      label: 'Reset Alternatives',
      onClick: () => {
        // Reset and re-seed alternatives
        // This is handled by re-initializing the VM
        location.reload();
      },
    },
  ]}
  toggles={[]}
/>
