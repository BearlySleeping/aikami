<script lang="ts">
// apps/frontend/client/src/lib/views/chat/chat_modes_sandbox_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ChatView from '$views/chat/chat_view.svelte';
import type { ChatModesSandboxViewModel } from './chat_modes_sandbox_view_model.svelte.ts';

type Props = {
  viewModel: ChatModesSandboxViewModel;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col h-full gap-4 p-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-bold font-mono">/dev/chat-modes</h1>
      <div class="flex items-center gap-2">
        <span class="text-xs text-base-content/50">Sandbox:</span>
        <span class="badge badge-info badge-xs">Address Modes</span>
        <span class="badge badge-success badge-xs">Impersonation</span>
        <span class="badge badge-warning badge-xs">Party Chat</span>
      </div>
    </div>

    <p class="text-sm text-base-content/70">
      Full address mode system demo. Toggle between Scene / Party / GM modes at the bottom. Enable
      the 🎭 Impersonate toggle in settings to show the quick-button. Type
      <code class="font-mono text-xs">/impersonate [direction]</code>
      to draft as your persona.
    </p>

    <!-- Mock persona notice for the sandbox -->
    <div class="alert alert-info text-sm">
      <span
        >📋 This sandbox uses a mock persona (<strong>Kael Thornwood</strong>, rogue, sarcastic).
        The impersonation service will use a real persona returned by personaService if available;
        otherwise the impersonation command will show the "Set up your persona" toast.</span
      >
    </div>

    <!-- Chat area (reuse production ChatView) -->
    <div class="flex-1 min-h-0">
      <ChatView {viewModel} />
    </div>

    <!-- Visual runner readiness marker -->
    <div data-testid="game-ready" class="hidden"></div>
  </div>
</BaseViewModelContainer>
