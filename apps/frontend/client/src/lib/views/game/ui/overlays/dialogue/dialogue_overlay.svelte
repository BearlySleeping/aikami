<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
  import type { DialogueOverlayViewModelInterface } from './dialogue_overlay_view_model.svelte';

  type Props = {
    viewModel: DialogueOverlayViewModelInterface;
  };

  const { viewModel }: Props = $props();

  /** Reference to the scrollable message container for auto-scroll. */
  let messageContainer = $state<HTMLDivElement>();

  /** Auto-scroll to the bottom when new messages arrive or AI is typing. */
  $effect(() => {
    // Track message count and AI typing state to trigger scroll
    const count = viewModel.messages.length;
    const typing = viewModel.isAiTyping;
    void count;
    void typing;

    if (messageContainer) {
      messageContainer.scrollTop = messageContainer.scrollHeight;
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="pointer-events-auto absolute inset-0 z-20 flex flex-col justify-end bg-base-300/40 backdrop-blur-sm"
  role="dialog"
  aria-label="Dialogue with {viewModel.npcName}"
>
  <!-- Dialogue Box — positioned at the bottom 40% of the screen -->
  <div
    class="mx-auto mb-8 flex w-full max-w-2xl flex-col rounded-xl border border-base-300 bg-base-200/90 shadow-2xl"
    style="height: 40vh;"
  >
    <!-- Header: NPC name + End Chat button -->
    <div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
      <h3 class="text-sm font-bold text-primary">{viewModel.npcName}</h3>
      <button class="btn btn-ghost btn-xs text-error" onclick={() => viewModel.endChat()}>
        End Chat
      </button>
    </div>

    <!-- Scrollable message history -->
    <div bind:this={messageContainer} class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      {#each viewModel.messages as message (message.id)}
        <div class="chat {message.sender === 'player' ? 'chat-end' : 'chat-start'}">
          <div class="chat-header mb-0.5 text-xs text-base-content/50">
            {message.sender === 'player' ? 'You' : viewModel.npcName}
          </div>
          <div
            class="chat-bubble text-sm {message.sender === 'player'
              ? 'chat-bubble-primary'
              : 'chat-bubble-secondary'}"
          >
            {message.text || ''}
          </div>
        </div>
      {/each}

      <!-- AI typing indicator -->
      {#if viewModel.isAiTyping}
        <div class="chat chat-start">
          <div class="chat-header mb-0.5 text-xs text-base-content/50">
            {viewModel.npcName}
          </div>
          <div class="chat-bubble chat-bubble-secondary text-sm">
            <span class="loading loading-dots loading-xs"></span>
          </div>
        </div>
      {/if}

      <!-- Error message -->
      {#if viewModel.errorMessage}
        <div class="rounded-lg bg-error/10 p-2 text-center text-xs text-error">
          {viewModel.errorMessage}
        </div>
      {/if}
    </div>

    <!-- Input area -->
    <div class="border-t border-base-300 px-4 py-3">
      <div class="flex items-end gap-2">
        <textarea
          class="textarea textarea-bordered textarea-sm flex-1 resize-none text-sm"
          rows="2"
          placeholder="Type your message..."
          value={viewModel.currentInput}
          oninput={(e) => viewModel.setInput(e.currentTarget.value)}
          onkeydown={(e) => viewModel.handleKeyDown(e)}
          disabled={viewModel.isAiTyping}
        ></textarea>
        <button
          class="btn btn-primary btn-sm"
          onclick={() => viewModel.sendMessage()}
          disabled={viewModel.isAiTyping || !viewModel.currentInput.trim()}
        >
          {#if viewModel.isAiTyping}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            Send
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>
