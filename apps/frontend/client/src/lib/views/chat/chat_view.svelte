<script lang="ts">
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
// apps/frontend/client/src/lib/views/chat/chat_view.svelte
import CharacterCard from '$lib/components/chat/character_card.svelte';
import TypingIndicator from '$lib/components/chat/typing_indicator.svelte';
import GuidedComposer from '$lib/components/messaging/guided_composer.svelte';
import RichMessageList from '$lib/components/messaging/rich_message_list.svelte';
import RichMessageRow from '$lib/components/messaging/rich_message_row.svelte';
import SuggestionChips from '$lib/components/messaging/suggestion_chips.svelte';
import AddressModeToggleView from '$views/gm/address_mode_toggle_view.svelte';
import { getAddressModeTogggleViewModel } from '$views/gm/address_mode_toggle_view_model.svelte.ts';
import PushStoryButtonView from '$views/gm/push_story_button_view.svelte';
import { getPushStoryButtonViewModel } from '$views/gm/push_story_button_view_model.svelte.ts';
import type { ChatViewModelInterface } from './chat_view_model.svelte.ts';
import ChoiceButtonsView from './choice_buttons_view.svelte';

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
              <button
                type="button"
                class="btn btn-sm btn-ghost mt-2"
                onclick={() => viewModel.dismissGreeting()}
              >
                Start Chat
              </button>
            {/if}
          </div>
        {/if}

        <div class="flex flex-col h-full">
          {#if !viewModel.showGreeting}
            <h2 class="text-lg font-semibold mb-2">Chat with {viewModel.npc.name}</h2>
          {/if}

          <RichMessageList
            messages={viewModel.messages}
            bind:containerElement={viewModel.messageContainerElement}
            containerClass="flex-1 overflow-y-auto border border-base-300 rounded-lg p-4 space-y-2 min-h-0"
            emptyText="Start the conversation with a suggestion below."
            isStreaming={viewModel.isTyping}
          >
            {#snippet renderRow(message)}
              <RichMessageRow
                {message}
                characterName={viewModel.npc.name}
                avatarUrl={viewModel.npc.avatarUrl}
                onAction={viewModel.handleMessageAction}
                onSwipe={(id, direction) => viewModel.swipeAlternative(id, direction)}
              />
            {/snippet}
            {#snippet after()}
              <TypingIndicator
                visible={viewModel.isTyping}
                label="{viewModel.npc.name} is typing..."
              />
              <!-- CYOA choice buttons below the latest AI message (C-245) -->
              <ChoiceButtonsView viewModel={viewModel.choiceButtonsViewModel} />
            {/snippet}
          </RichMessageList>

          <!-- Slash command autocomplete popup -->
          {#if viewModel.showSlashCompletions}
            <div class="relative">
              <ul
                class="menu menu-sm bg-base-200 rounded-lg shadow-lg border border-base-300 absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto z-40"
                data-testid="slash-autocomplete-menu"
              >
                {#each viewModel.slashCompletions as cmd, i}
                  <li>
                    <button
                      type="button"
                      class:menu-active={i === viewModel.selectedSlashCompletion}
                      onmousedown={(e) => {
                        e.preventDefault();
                        viewModel.selectAndApplySlashCompletion(i);
                      }}
                    >
                      <span class="font-mono font-bold">/{cmd.name}</span>
                      <span class="text-xs text-base-content/50">{cmd.description}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <!-- Input area with auto-resize textarea -->
          <div class="mt-4">
            <GuidedComposer
              value={viewModel.inputText}
              onInput={(text) => viewModel.onInputChange(text)}
              onSend={() => viewModel.handleSend()}
              onKeyDown={(e) => viewModel.handleKeyDown(e)}
              placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
              disabled={viewModel.isSending || viewModel.isImpersonationDrafting}
              sendDisabled={viewModel.isSending || !viewModel.inputText.trim()}
              isSending={viewModel.isSending}
              sendLabel="Send"
              textareaRef={(el) => {
                if (el) {
                  viewModel.setFocusTextareaCallback(() => el.focus());
                }
              }}
            >
              {#snippet above()}
                <!-- Suggestion chips — shared component (C-420) -->
                <SuggestionChips
                  chips={viewModel.suggestedChips}
                  disabled={viewModel.isSending || viewModel.isImpersonationDrafting}
                  onSelect={(chipId) => viewModel.handleChipTap(chipId)}
                />
              {/snippet}
              {#snippet extras()}
                {#if viewModel.impersonationConfig.quickButtonEnabled}
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    title="Draft as your persona"
                    onclick={() => viewModel.handleImpersonateDraft()}
                    disabled={viewModel.isSending || viewModel.isImpersonationDrafting}
                  >
                    {#if viewModel.isImpersonationDrafting}
                      <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                      🎭
                    {/if}
                  </button>
                {/if}
              {/snippet}
            </GuidedComposer>
          </div>

          <!-- Chat settings: Streaming TTS + Impersonation toggle -->
          <div class="mt-2 flex items-center justify-end gap-3">
            <label class="flex items-center gap-1 cursor-pointer">
              <span class="text-xs text-base-content/50">Streaming TTS</span>
              <input
                type="checkbox"
                class="toggle toggle-xs"
                checked={viewModel.streamingTtsEnabled}
                onclick={() => viewModel.toggleStreamingTts()}
              >
            </label>
            <label class="flex items-center gap-1 cursor-pointer">
              <span class="text-xs text-base-content/50">🎭 Impersonate</span>
              <input
                type="checkbox"
                class="toggle toggle-xs"
                checked={viewModel.impersonationConfig.quickButtonEnabled}
                onclick={() => viewModel.toggleImpersonationQuickButton()}
              >
            </label>
            {#if viewModel.impersonationConfig.quickButtonEnabled}
              <label
                class="flex items-center gap-1 cursor-pointer"
                data-testid="cyoa-as-direction-toggle"
              >
                <span class="text-xs text-base-content/50">Use CYOA as direction</span>
                <input
                  type="checkbox"
                  class="toggle toggle-xs"
                  checked={viewModel.useCyoaAsDirection}
                  onclick={() => viewModel.toggleUseCyoaAsDirection()}
                >
              </label>
            {/if}
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
