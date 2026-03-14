<script lang="ts">
  import type { ChatMessage as ChatMessageType } from '$lib/client/services/chat/chat.svelte.ts';
  import ChatInput from './ChatInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import TypingIndicator from './TypingIndicator.svelte';

  /**
   * Props for the ChatContainer component.
   * Main chat interface that displays messages and provides input.
   */
  type Props = {
    /** Array of chat messages to display */
    messages: ChatMessageType[];
    /** Whether messages are currently loading */
    isLoading?: boolean;
    /** Whether a message is currently being sent */
    isSending?: boolean;
    /** Whether the AI is typing (show typing indicator) */
    isTyping?: boolean;
    /** Callback function when user sends a message */
    onSend: (message: string) => void;
    /** Optional title to display above chat */
    title?: string;
    /** Name of the character being chatted with */
    characterName?: string;
    /** Avatar URL of the character being chatted with */
    characterAvatarUrl?: string;
  };

  let {
    messages,
    isLoading = false,
    isSending = false,
    isTyping = false,
    onSend,
    title = 'Chat',
    characterName = 'AI',
    characterAvatarUrl,
  }: Props = $props();

  let message = $state('');
  let messagesContainer: HTMLDivElement;

  $effect(() => {
    if (messages.length > 0 && messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  function _handleSend(msg: string) {
    onSend(msg);
  }
</script>

<div class="flex flex-col h-full">
  {#if title}
    <h2 class="text-lg font-semibold mb-2">{title}</h2>
  {/if}

  <div
    bind:this={messagesContainer}
    class="flex-1 overflow-y-auto border border-base-300 rounded-lg p-4 space-y-2 min-h-0"
  >
    {#if isLoading}
      <div class="flex justify-center py-4"><span class="loading loading-spinner"></span></div>
    {:else if messages.length === 0}
      <div class="flex items-center justify-center h-full opacity-50">
        <p>No messages yet. Start the conversation!</p>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <ChatMessage {message} {characterName} avatarUrl={characterAvatarUrl} />
      {/each}
    {/if}
    <TypingIndicator visible={isTyping} label="{characterName} is typing..." />
  </div>

  <div class="mt-4">
    <ChatInput
      bind:message
      {isSending}
      {onSend}
      placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
    />
  </div>
</div>
