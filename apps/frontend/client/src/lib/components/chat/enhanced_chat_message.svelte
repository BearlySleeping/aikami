<script lang="ts">
  // apps/frontend/client/src/lib/components/chat/enhanced_chat_message.svelte
  //
  // Enhanced chat message bubble with hover-visible action bar and
  // alternative swipe controls. Wraps the base ChatMessage component
  // with C-231 Rich Chat Streaming enhancements.
  //
  // Contract: C-231 AC-1, AC-3

  import { messageBranchStore } from '$services';
  import type { MessageAction } from '$types/rich_chat';
  import ChatMessage from './chat_message.svelte';
  import MessageActionBar from './message_action_bar.svelte';
  import MessageSwipeControls from './message_swipe_controls.svelte';

  type Props = {
    /** The base message (without alternatives — text comes from active alt). */
    id: string;
    text: string;
    sender: 'user' | 'ai' | 'system';
    timestamp: Date;
    /** Avatar URL for the AI character. */
    avatarUrl?: string;
    /** Name of the AI character. */
    characterName?: string;
    /** Whether TTS is available for speak action. */
    ttsAvailable?: boolean;
    /** Called when an action is invoked. */
    onAction?: (messageId: string, action: MessageAction) => void;
  };

  const {
    id: messageId,
    text,
    sender,
    timestamp,
    avatarUrl,
    characterName = 'AI',
    ttsAvailable = false,
    onAction,
  }: Props = $props();

  // ── Alternative tracking ──────────────────────────────────────────────

  const enriched = $derived(
    messageBranchStore.enrichMessage({
      id: messageId,
      text,
      sender,
      timestamp,
    }),
  );

  // ── Action handler ────────────────────────────────────────────────────

  const handleAction = (action: MessageAction) => {
    onAction?.(messageId, action);
  };

  // ── Swipe handlers ────────────────────────────────────────────────────

  const handleSwipeLeft = () => {
    messageBranchStore.swipeAlternative({ messageId, direction: 'left' });
  };

  const handleSwipeRight = () => {
    messageBranchStore.swipeAlternative({ messageId, direction: 'right' });
  };
</script>

<div class="group relative">
  <!-- Swipe controls (top-right of message) -->
  <div class="absolute -top-6 right-0 z-10">
    <MessageSwipeControls
      canSwipeLeft={enriched.canSwipeLeft}
      canSwipeRight={enriched.canSwipeRight}
      label={enriched.alternativeLabel}
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
    />
  </div>

  <ChatMessage
    message={{
      id: messageId,
      text: enriched.text,
      sender: sender as 'user' | 'ai',
      timestamp,
    }}
    {avatarUrl}
    {characterName}
  />

  <!-- Action bar (appears on hover) -->
  <MessageActionBar {sender} {ttsAvailable} onAction={handleAction} />
</div>
