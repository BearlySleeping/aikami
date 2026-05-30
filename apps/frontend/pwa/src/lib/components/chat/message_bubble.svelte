<script lang="ts">
  // apps/frontend/pwa/src/lib/components/chat/MessageBubble.svelte
  import type { ChatMessage as ChatMessageType } from '$lib/client/services/chat/chat.svelte.ts';

  type Props = {
    message: ChatMessageType;
    avatarUrl?: string;
    characterName?: string;
    showActions?: boolean;
    isEditing?: boolean;
    editText?: string;
    onEdit?: (messageId: string, newText: string) => void;
    onDelete?: (messageId: string) => void;
    onRegenerate?: (messageId: string) => void;
    onPlayTts?: (messageId: string) => void;
    onCancelEdit?: () => void;
  };

  const {
    message,
    avatarUrl,
    characterName = 'AI',
    showActions = true,
    isEditing = false,
    editText = '',
    onEdit,
    onDelete,
    onRegenerate,
    onPlayTts,
    onCancelEdit,
  }: Props = $props();

  let localEditText = $state(editText);

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
    if (processed.startsWith('/me ')) processed = processed.slice(4);
    if (processed.startsWith('*') && processed.endsWith('*')) processed = processed.slice(1, -1);
    return processed;
  }

  function handleSaveEdit() {
    if (onEdit && localEditText.trim()) {
      onEdit(message.id, localEditText.trim());
    }
  }

  const messageType = $derived(detectMessageType(message.text));
  const isAction = $derived(messageType === 'action');
  const isSystem = $derived(messageType === 'system');
  const isAi = $derived(message.sender === 'ai');
</script>

<div class="chat {message.sender === 'user' ? 'chat-end' : 'chat-start'}">
  {#if isAi && avatarUrl && !isAction}
    <div class="chat-image avatar">
      <div class="w-8 rounded-full"><img src={avatarUrl} alt={characterName}></div>
    </div>
  {/if}

  <div class="chat-header opacity-70 text-xs mb-1 flex items-center gap-2">
    {#if isAction}
      <span class="italic">{characterName}</span>
    {:else}
      <span>{message.sender === 'user' ? 'You' : characterName}</span>
    {/if}
    <time class="text-xs opacity-50">{formatTime(message.timestamp)}</time>
  </div>

  {#if isEditing}
    <div class="chat-bubble chat-bubble-info">
      <textarea
        class="w-full textarea textarea-bordered textarea-sm"
        bind:value={localEditText}
        rows="3"
      ></textarea>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-xs btn-primary" onclick={handleSaveEdit}>Save</button>
        <button class="btn btn-xs btn-ghost" onclick={onCancelEdit}>Cancel</button>
      </div>
    </div>
  {:else}
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
      {:else}
        {message.text}
      {/if}
    </div>
  {/if}

  {#if showActions && !isEditing}
    <div class="chat-footer opacity-50 flex gap-1 mt-1">
      {#if !isAi}
        <button
          class="btn btn-xs btn-ghost"
          onclick={() => onEdit?.(message.id, message.text)}
          title="Edit"
        >
          ✏️ Edit
        </button>
        <button class="btn btn-xs btn-ghost" onclick={() => onDelete?.(message.id)} title="Delete">
          🗑️ Delete
        </button>
      {/if}
      {#if isAi}
        <button
          class="btn btn-xs btn-ghost"
          onclick={() => onRegenerate?.(message.id)}
          title="Regenerate"
        >
          🔄 Regenerate
        </button>
      {/if}
      <button class="btn btn-xs btn-ghost" onclick={() => onPlayTts?.(message.id)} title="Play TTS">
        🔊
      </button>
    </div>
  {/if}
</div>
