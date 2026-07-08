<script lang="ts">
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  // apps/frontend/client/src/lib/views/chat/chat_view.svelte
  import AutoResizeTextarea from '$lib/components/chat/auto_resize_textarea.svelte';
  import CharacterCard from '$lib/components/chat/character_card.svelte';
  import EnhancedChatMessage from '$lib/components/chat/enhanced_chat_message.svelte';
  import TypingIndicator from '$lib/components/chat/typing_indicator.svelte';
  import AddressModeToggleView from '$views/gm/address_mode_toggle_view.svelte';
  import { getAddressModeTogggleViewModel } from '$views/gm/address_mode_toggle_view_model.svelte.ts';
  import PushStoryButtonView from '$views/gm/push_story_button_view.svelte';
  import { getPushStoryButtonViewModel } from '$views/gm/push_story_button_view_model.svelte.ts';
  import type { ChatViewModelInterface } from './chat_view_model.svelte.ts';

  type Props = {
    viewModel: ChatViewModelInterface;
  };

  const { viewModel }: Props = $props();

  // GM system sub-ViewModels (optional — default factories)
  const addressModeViewModel = getAddressModeTogggleViewModel({
    className: 'AddressModeToggleViewModel',
    initialMode: 'scene',
  });
  const pushStoryViewModel = getPushStoryButtonViewModel({
    className: 'PushStoryButtonViewModel',
  });
</script>

<BaseViewModelContainer {viewModel}>
  <div class="card bg-base-100 shadow-xl h-full">
    <div class="card-body p-4">
      {#if viewModel.errorMessage}
        <div class="alert alert-error"><span>{viewModel.errorMessage}</span></div>
      {/if}

      {#if viewModel.chatError}
        <div class="alert alert-error"><span>{viewModel.chatError}</span></div>
      {/if}

      <!-- Toast notification -->
      {#if viewModel.toastMessage}
        <div class="toast toast-top toast-end z-50">
          <div class="alert alert-success text-sm">{viewModel.toastMessage}</div>
        </div>
      {/if}

      {#if viewModel.isLoading}
        <div class="flex justify-center"><span class="loading loading-spinner"></span></div>
      {:else if viewModel.npc}
        {#if viewModel.showGreeting}
          <div class="mb-4">
            <CharacterCard
              name={viewModel.npc.name}
              avatarUrl={viewModel.npc.avatarUrl}
              race={viewModel.npc.race}
              characterClass={viewModel.npc.class}
              level={viewModel.npc.level}
              personalityTraits={viewModel.npc.personalityTraits}
              background={viewModel.npc.background}
              notes={viewModel.npc.notes}
            />
            {#if viewModel.npc.notes}
              <button class="btn btn-sm btn-ghost mt-2" onclick={() => viewModel.dismissGreeting()}>
                Start Chat
              </button>
            {/if}
          </div>
        {/if}

        <div class="flex flex-col h-full">
          {#if !viewModel.showGreeting}
            <h2 class="text-lg font-semibold mb-2">Chat with {viewModel.npc.name}</h2>
          {/if}

          <div
            bind:this={viewModel.messageContainerElement}
            class="flex-1 overflow-y-auto border border-base-300 rounded-lg p-4 space-y-2 min-h-0"
          >
            {#if viewModel.messages.length === 0}
              <div class="flex items-center justify-center h-full opacity-50">
                <p>No messages yet. Start the conversation!</p>
              </div>
            {:else}
              {#each viewModel.messages as message (message.id)}
                <EnhancedChatMessage
                  id={message.id}
                  text={message.text}
                  sender={message.sender}
                  timestamp={message.timestamp}
                  avatarUrl={viewModel.npc.avatarUrl}
                  characterName={viewModel.npc.name}
                  ttsAvailable={true}
                  onAction={viewModel.handleMessageAction}
                />
              {/each}
            {/if}
            <TypingIndicator
              visible={viewModel.isTyping}
              label="{viewModel.npc.name} is typing..."
            />
          </div>

          <!-- Input area with auto-resize textarea -->
          <div class="mt-4 flex items-end gap-2">
            <div class="flex-1">
              <AutoResizeTextarea
                value={viewModel.inputText}
                onchange={(text) => viewModel.onInputChange(text)}
                placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
                disabled={viewModel.isSending}
                class="w-full"
              />
            </div>
            <button
              class="btn btn-primary btn-sm"
              onclick={() => viewModel.handleSend()}
              disabled={viewModel.isSending || !viewModel.inputText.trim()}
            >
              {#if viewModel.isSending}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                Send
              {/if}
            </button>
          </div>

          <!-- Streaming TTS toggle -->
          <div class="mt-2 flex items-center justify-end gap-2">
            <span class="text-xs text-base-content/50">Streaming TTS</span>
            <input
              type="checkbox"
              class="toggle toggle-xs"
              checked={viewModel.streamingTtsEnabled}
              onclick={() => viewModel.toggleStreamingTts()}
            >
          </div>

          <!-- GM Controls (visible in GM mode) -->
          <div class="mt-3 pt-3 border-t border-base-300 flex items-center justify-between">
            <AddressModeToggleView viewModel={addressModeViewModel} />
            <PushStoryButtonView viewModel={pushStoryViewModel} />
          </div>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
