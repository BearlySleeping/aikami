<script lang="ts">
import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
import CharacterCard from '$lib/components/chat/CharacterCard.svelte';
import ChatContainer from '$lib/components/chat/ChatContainer.svelte';
import type { ChatViewModelInterface } from './chat-view-model.svelte.ts';

type Props = {
  viewModel: ChatViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-4 h-full">
    <div class="card bg-base-100 shadow-xl h-full">
      <div class="card-body p-4">
        {#if viewModel.errorMessage}
          <div class="alert alert-error">
            <span>{viewModel.errorMessage}</span>
          </div>
        {/if}

        {#if viewModel.error}
          <div class="alert alert-error">
            <span>{viewModel.error}</span>
          </div>
        {/if}

        {#if viewModel.isLoading}
          <div class="flex justify-center">
            <span class="loading loading-spinner"></span>
          </div>
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
                  class="btn btn-sm btn-ghost mt-2"
                  onclick={() => viewModel.dismissGreeting()}
                >
                  Start Chat
                </button>
              {/if}
            </div>
          {/if}
          <ChatContainer
            messages={viewModel.messages}
            isLoading={viewModel.isLoading}
            isSending={viewModel.isSending}
            isTyping={viewModel.isTyping}
            onSend={(text) => viewModel.sendMessage(text)}
            title={viewModel.showGreeting ? undefined : "Chat with " + viewModel.npc.name}
            characterName={viewModel.npc.name}
            characterAvatarUrl={viewModel.npc.avatarUrl}
          />
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
