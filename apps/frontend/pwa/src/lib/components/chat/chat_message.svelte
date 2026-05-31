<script lang="ts">
  import type { ChatMessage as ChatMessageType } from '$lib/client/services/chat/chat.svelte.ts';
  import { ttsService } from '$services';

  /**
   * Props for the ChatMessage component.
   * Displays a single chat message with appropriate styling based on sender and type.
   */
  type Props = {
    /** The message object to display */
    message: ChatMessageType;
    /** Avatar URL for the AI character */
    avatarUrl?: string;
    /** Name of the AI character */
    characterName?: string;
  };

  const { message, avatarUrl, characterName = 'AI' }: Props = $props();

  function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function detectMessageType(text: string): 'action' | 'system' | 'normal' {
    const trimmed = text.trim();
    if (trimmed.startsWith('/me ') || (trimmed.startsWith('*') && trimmed.endsWith('*'))) {
      return 'action';
    }
    if (trimmed.startsWith('[System]') || trimmed.startsWith('/system ')) {
      return 'system';
    }
    return 'normal';
  }

  function formatActionText(text: string): string {
    let processed = text.trim();
    if (processed.startsWith('/me ')) {
      processed = processed.slice(4);
    }
    if (processed.startsWith('*') && processed.endsWith('*')) {
      processed = processed.slice(1, -1);
    }
    return processed;
  }

  const messageType = $derived(detectMessageType(message.text));
  const isAction = $derived(messageType === 'action');
  const isSystem = $derived(messageType === 'system');
</script>

<div class="chat {message.sender === 'user' ? 'chat-end' : 'chat-start'}">
  {#if message.sender === 'ai' && avatarUrl && !isAction}
    <div class="chat-image avatar">
      <div class="w-8 rounded-full"><img src={avatarUrl} alt={characterName}></div>
    </div>
  {/if}
  <div class="chat-header opacity-70 text-xs mb-1">
    {#if isAction}
      <span class="italic">{characterName}</span>
    {:else}
      {message.sender === 'user' ? 'You' : characterName}
    {/if}
    <time class="text-xs opacity-50 ml-2"> {formatTime(message.timestamp)} </time>
  </div>
  <div
    class="chat-bubble {isAction
      ? 'chat-bubble-accent'
      : isSystem
        ? 'chat-bubble-warning'
        : message.sender === 'user'
          ? 'chat-bubble-primary'
          : 'chat-bubble-secondary'}"
  >
    {#if isAction}
      <span class="italic">* {formatActionText(message.text)} *</span>
    {:else if ttsService.active_message_id === message.id && ttsService.is_playing}
      {#each message.text.split(/\s+/) as word, index}
        <span class={index === ttsService.current_word_index ? 'text-primary-500' : ''}>
          {word}
        </span>
      {/each}
    {:else}
      {message.text}
    {/if}
  </div>
</div>
