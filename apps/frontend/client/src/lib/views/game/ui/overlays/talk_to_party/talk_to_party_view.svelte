<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view.svelte
import AutoResizeTextarea from '$lib/components/chat/auto_resize_textarea.svelte';
import type { TalkToPartyViewModelInterface } from './talk_to_party_view_model.svelte';

type Props = {
  viewModel: TalkToPartyViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="Talking to {viewModel.npcName}"
  tabindex="-1"
  onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			viewModel.close();
		}
	}}
>
  <div
    class="mx-auto flex w-full max-w-2xl flex-col rounded-xl border border-base-300 bg-base-200/95 shadow-2xl"
    style="height: 50vh;"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-bold text-primary">{viewModel.npcName}</h3>
        <span
          class="badge badge-xs {viewModel.approval > 0 ? 'badge-success' : viewModel.approval < 0 ? 'badge-error' : 'badge-ghost'}"
        >
          {viewModel.approval > 0 ? '+' : ''}{viewModel.approval}
        </span>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs text-error"
        onclick={() => viewModel.close()}
      >
        Close
      </button>
    </div>

    <!-- Messages -->
    <div class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      {#each viewModel.messages as message (message.id)}
        <div class="chat {message.role === 'player' ? 'chat-end' : 'chat-start'}">
          <div class="chat-header mb-0.5 text-xs text-base-content/50">
            {message.role === 'player' ? 'You' : viewModel.npcName}
          </div>
          <div
            class="chat-bubble text-sm {message.role === 'player'
							? 'chat-bubble-primary'
							: 'chat-bubble-secondary'}"
          >
            {message.content}
          </div>
        </div>
      {/each}

      {#if viewModel.isStreaming}
        <div class="chat chat-start">
          <div class="chat-bubble chat-bubble-secondary text-sm">
            <span class="loading loading-dots loading-xs"></span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Input area -->
    <div class="border-t border-base-300 px-4 py-3">
      <div class="flex items-end gap-2">
        <div class="flex-1">
          <AutoResizeTextarea
            value={viewModel.inputText}
            onchange={(text) => viewModel.setInput(text)}
            onkeydown={(e) => viewModel.handleKeyDown(e)}
            disabled={viewModel.isStreaming}
            placeholder="Talk to {viewModel.npcName}..."
            class="w-full"
          />
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={() => viewModel.sendMessage()}
          disabled={viewModel.isStreaming || !viewModel.inputText.trim()}
        >
          {#if viewModel.isStreaming}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            Send
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>
