<script lang="ts">
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { GroupChatViewModelInterface } from './group-chat-view-model.svelte.ts';

  type Props = {
    viewModel: GroupChatViewModelInterface;
  };
  const { viewModel }: Props = $props();

  let messageInput = $state('');

  function handleSend() {
    if (messageInput.trim()) {
      viewModel.sendMessage(messageInput);
      messageInput = '';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col h-screen">
    <div class="navbar bg-base-200">
      <div class="flex-1"><a href="/group-chats" class="btn btn-ghost">← Back</a></div>
      <div class="flex-none">
        <span class="text-xl font-bold"> {viewModel.groupChat?.name || 'Group Chat'} </span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      {#if viewModel.isLoading}
        <div class="flex justify-center"><span class="loading loading-spinner"></span></div>
      {:else}
        {#each viewModel.messages as message (message.id)}
          <div
            class="chat"
            class:chat-end={message.sender === 'user'}
            class:chat-start={message.sender === 'character'}
          >
            <div class="chat-header mb-1">{message.characterName}</div>
            <div class="chat-bubble" class:chat-bubble-primary={message.sender === 'user'}>
              {message.text}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="p-4 bg-base-200">
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={messageInput}
          placeholder={t.typeYourMessage()}
          class="input input-bordered flex-1"
          onkeydown={handleKeydown}
          disabled={viewModel.isSending}
        >
        <button
          class="btn btn-primary"
          onclick={handleSend}
          disabled={viewModel.isSending || !messageInput.trim()}
        >
          {#if viewModel.isSending}
            <span class="loading loading-spinner"></span>
          {:else}
            {t.send()}
          {/if}
        </button>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
