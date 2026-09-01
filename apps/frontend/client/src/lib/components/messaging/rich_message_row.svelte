<script lang="ts">
// apps/frontend/client/src/lib/components/messaging/rich_message_row.svelte
//
// Shared message row renderer used by both the chat surface and the
// in-game dialogue overlay (C-424). Owns the message bubble, the action
// affordances, swipe/alternate controls and dice cards.
//
// Two variants:
//   - 'chat'     — floating action bar + swipe (the C-231 rich message row).
//   - 'dialogue' — inline action buttons + swipe, party avatars, `formatNpcText`
//                  segment styling, inline editing, and streamed narrative.
//
// Surface-specific extras under a message (images, roll banners) are passed
// in via the `renderFooter` snippet.
//
// Contract: C-424 Unified Message Surfaces
import type { Snippet } from 'svelte';
import { Image } from '$components';
import ChatMessage from '$lib/components/chat/chat_message.svelte';
import MessageActionBar from '$lib/components/chat/message_action_bar.svelte';
import MessageSwipeControls from '$lib/components/chat/message_swipe_controls.svelte';
import DiceCard from '$lib/components/game/dice_card.svelte';
import { messageBranchStore } from '$services';
import type { MessageAction, RichMessage } from '$types';

type Props = {
  /** The message to render. */
  message: RichMessage;
  /** Display name of the AI/NPC character. */
  characterName?: string;
  /** Avatar URL for the AI/NPC character. */
  avatarUrl?: string;
  /** Whether the surface is streaming a response. */
  isStreaming?: boolean;
  /** Whether this is the last message in the list. */
  isLast?: boolean;
  /** Called when a message action is invoked (chat variant). */
  onAction?: (messageId: string, action: MessageAction) => void;
  /** Surface-specific extras rendered under this message. */
  renderFooter?: (messageId: string) => Snippet<[]>;
  /** Row variant — 'chat' (default) or 'dialogue'. */
  variant?: 'chat' | 'dialogue';
  // ── dialogue-specific ──────────────────────────────────────────────
  /** Whether the party UI (avatars + names above bubbles) is shown. */
  showPartyUi?: boolean;
  /** Player avatar URL (dialogue). */
  playerAvatarUrl?: string;
  /** NPC avatar URL (dialogue). */
  npcAvatarUrl?: string;
  /** Optional sender display name (party mate). */
  senderName?: string;
  /** Whether this message is from a party mate (renders on the right). */
  isPartyMate?: boolean;
  /** Whether this message is being edited inline (dialogue). */
  editing?: boolean;
  /** Current edit text (dialogue). */
  editText?: string;
  /** Called when the edit text changes (dialogue). */
  onEditChange?: (text: string) => void;
  /** Called to save an edit (dialogue). */
  onEditSave?: (messageId: string) => void;
  /** Called to cancel an edit (dialogue). */
  onEditCancel?: () => void;
  /** Streamed narrative text for the in-flight turn (dialogue). */
  streamingText?: string;
  /** Whether a skill check is being resolved (dialogue). */
  isResolvingSkillCheck?: boolean;
  /** Whether TTS is available — gates the speak action (dialogue). */
  ttsAvailable?: boolean;
  /** Called when the user swipes an alternative (dialogue). */
  onSwipe?: (messageId: string, direction: 'left' | 'right') => void;
  /** Alternative counter label (dialogue). */
  alternativeLabel?: string;
  /** Whether swipe left is available (dialogue). */
  canSwipeLeft?: boolean;
  /** Whether swipe right is available (dialogue). */
  canSwipeRight?: boolean;
};

const {
  message,
  characterName = 'AI',
  avatarUrl,
  isStreaming = false,
  isLast = false,
  onAction,
  renderFooter,
  variant = 'chat',
  showPartyUi = false,
  playerAvatarUrl,
  npcAvatarUrl,
  senderName,
  isPartyMate = false,
  editing = false,
  editText = '',
  onEditChange,
  onEditSave,
  onEditCancel,
  streamingText = '',
  isResolvingSkillCheck = false,
  ttsAvailable = false,
  onSwipe,
  alternativeLabel = '',
  canSwipeLeft = false,
  canSwipeRight = false,
}: Props = $props();

const isPlayer = $derived(message.sender === 'user');
const alignRight = $derived(isPlayer || isPartyMate);

/** Chat variant: enrich alternatives from the branch store (C-231). */
const enriched = $derived(
  variant === 'chat'
    ? messageBranchStore.enrichMessage({
        id: message.id,
        text: message.text,
        sender: message.sender,
        timestamp: message.timestamp,
      })
    : undefined,
);

/** Parses NPC text into styled segments (*action* / "dialogue" / text). */
const formatNpcTextSegments = (
  text: string,
): Array<{ type: 'action' | 'dialogue' | 'text'; content: string }> => {
  const segments: Array<{ type: 'action' | 'dialogue' | 'text'; content: string }> = [];
  const re = /(\*[^*]+\*)|("[^"]+")|([^*"]+)|(\*|")/g;
  let match = re.exec(text);
  while (match !== null) {
    if (match[1]) {
      segments.push({ type: 'action', content: match[1].replace(/^\*|\*$/g, '') });
    } else if (match[2]) {
      segments.push({ type: 'dialogue', content: match[2].replace(/^"|"$/g, '') });
    } else if (match[3]) {
      segments.push({ type: 'text', content: match[3] });
    } else if (match[4]) {
      segments.push({ type: 'text', content: match[4] });
    }
    match = re.exec(text);
  }
  return segments;
};

/** Bubble styling for a sender role (dialogue). */
const bubbleClassFor = (): string => {
  if (isPlayer) {
    return 'rounded-br-md bg-primary text-primary-content';
  }
  if (isPartyMate) {
    return 'rounded-br-md bg-info/20 text-info-content border border-info/20';
  }
  return 'rounded-bl-md bg-base-100 text-base-content';
};

/** Avatar URL for a dialogue sender. */
const avatarUrlFor = (): string => {
  if (isPlayer) {
    return playerAvatarUrl ?? '';
  }
  if (isPartyMate) {
    return '/assets/npc/gandalf/neutral.webp';
  }
  return npcAvatarUrl ?? '';
};

const handleAction = (action: MessageAction) => {
  onAction?.(message.id, action);
};

const handleSwipeLeft = () => {
  onSwipe?.(message.id, 'left');
};

const handleSwipeRight = () => {
  onSwipe?.(message.id, 'right');
};
</script>

{#if variant === 'dialogue'}
  <!-- ── Dialogue variant ─────────────────────────────────────────────── -->
  <div class="group flex gap-2 {alignRight ? 'flex-row-reverse' : 'flex-row'}">
    <div class="flex max-w-[75%] flex-col gap-0.5">
      {#if editing}
        <div class="flex flex-col gap-1">
          <textarea
            class="textarea textarea-bordered textarea-sm w-full"
            rows={3}
            value={editText}
            oninput={(e) => onEditChange?.((e.target as HTMLTextAreaElement).value)}
          ></textarea>
          <div class="flex gap-1 justify-end">
            <button type="button" class="btn btn-ghost btn-xs" onclick={() => onEditCancel?.()}>
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary btn-xs"
              onclick={() => onEditSave?.(message.id)}
            >
              Save
            </button>
          </div>
        </div>
      {:else}
        {#if showPartyUi}
          <div class="flex items-center gap-1.5 mb-0.5">
            <Image
              src={avatarUrlFor()}
              alt={senderName || (isPlayer ? 'You' : characterName)}
              class="h-5 w-5 rounded-full object-cover"
              loading="lazy"
            />
            <span class="text-xs font-medium text-base-content/50">
              {senderName || (isPlayer ? 'You' : characterName)}
            </span>
          </div>
        {/if}
        <div
          class="relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm {bubbleClassFor()}"
        >
          {#if message.text}
            {#if isPlayer}
              {message.text}
            {:else}
              {#each formatNpcTextSegments(message.text) as segment}
                {#if segment.type === 'action'}
                  <span class="italic text-base-content/60">*{segment.content}*</span>
                {:else if segment.type === 'dialogue'}
                  <span class="text-base-content">"{segment.content}"</span>
                {:else}
                  {segment.content}
                {/if}
              {/each}
            {/if}
          {:else if (isStreaming || isResolvingSkillCheck) && isLast && streamingText}
            <span class="inline-block" role="status" data-testid="dialogue-streaming-text">
              {#each formatNpcTextSegments(streamingText) as segment}
                {#if segment.type === 'action'}
                  <span class="italic text-base-content/60">*{segment.content}*</span>
                {:else if segment.type === 'dialogue'}
                  <span class="text-base-content">"{segment.content}"</span>
                {:else}
                  {segment.content}
                {/if}
              {/each}
            </span>
          {:else if (isStreaming || isResolvingSkillCheck) && isLast}
            <span class="inline-flex items-center gap-1" role="status" aria-label="NPC is typing">
              <span class="h-1.5 w-1.5 rounded-full bg-current opacity-45 animate-bounce"></span>
              <span
                class="h-1.5 w-1.5 rounded-full bg-current opacity-65 animate-bounce"
                style="animation-delay: 150ms"
              ></span>
              <span
                class="h-1.5 w-1.5 rounded-full bg-current opacity-85 animate-bounce"
                style="animation-delay: 300ms"
              ></span>
            </span>
          {/if}
        </div>
      {/if}

      <!-- Action buttons (hover-visible) -->
      <div
        class="flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100 {alignRight ? 'justify-end' : 'justify-start'}"
      >
        {#if !isPlayer && !isPartyMate}
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Copy"
            aria-label="Copy"
            onclick={() => onAction?.(message.id, 'copy')}
          >
            📋
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Retry"
            aria-label="Retry"
            disabled={isStreaming}
            onclick={() => onAction?.(message.id, 'retry')}
          >
            🔄
          </button>
          {#if ttsAvailable}
            <button
              type="button"
              class="btn btn-ghost btn-xs px-1"
              title="Speak"
              aria-label="Speak"
              onclick={() => onAction?.(message.id, 'speak')}
            >
              🔊
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Branch"
            aria-label="Branch"
            onclick={() => onAction?.(message.id, 'branch')}
          >
            🌿
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Copy"
            aria-label="Copy"
            onclick={() => onAction?.(message.id, 'copy')}
          >
            📋
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Edit"
            aria-label="Edit"
            disabled={isStreaming}
            onclick={() => onAction?.(message.id, 'edit')}
          >
            ✏️
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Delete"
            aria-label="Delete"
            disabled={isStreaming}
            onclick={() => onAction?.(message.id, 'delete')}
          >
            🗑️
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            title="Branch"
            aria-label="Branch"
            onclick={() => onAction?.(message.id, 'branch')}
          >
            🌿
          </button>
        {/if}
      </div>

      <!-- Swipe controls for AI messages with alternatives -->
      {#if !isPlayer && !isPartyMate && alternativeLabel}
        <div class="flex items-center justify-center gap-1 mt-0.5">
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            disabled={!canSwipeLeft}
            onclick={handleSwipeLeft}
            aria-label="Previous alternative"
          >
            ◀
          </button>
          <span class="text-xs font-mono text-base-content/50">{alternativeLabel}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            disabled={!canSwipeRight}
            onclick={handleSwipeRight}
            aria-label="Next alternative"
          >
            ▶
          </button>
        </div>
      {/if}
    </div>
  </div>

  {#if renderFooter}
    {@render renderFooter(message.id)}
  {/if}
{:else}
  <!-- ── Chat variant (C-231 rich message row) ────────────────────────── -->
  <div class="group relative">
    <!-- Swipe controls (top-right of message) -->
    <div class="absolute -top-6 right-0 z-10">
      <MessageSwipeControls
        canSwipeLeft={enriched?.canSwipeLeft ?? canSwipeLeft}
        canSwipeRight={enriched?.canSwipeRight ?? canSwipeRight}
        label={enriched?.alternativeLabel ?? alternativeLabel}
        onSwipeLeft={handleSwipeLeft}
        onSwipeRight={handleSwipeRight}
      />
    </div>

    {#if message.kind === 'dice' && message.dice}
      <DiceCard card={message.dice} />
    {:else}
      <ChatMessage
        message={{
          id: message.id,
          text: message.text,
          sender: (isPlayer ? 'user' : 'ai') as 'user' | 'ai',
          timestamp: message.timestamp,
        }}
        {avatarUrl}
        {characterName}
      />
    {/if}

    <!-- Action bar (appears on hover) -->
    <MessageActionBar sender={message.sender} {ttsAvailable} onAction={handleAction} />

    {#if renderFooter}
      {@render renderFooter(message.id)}
    {/if}
  </div>
{/if}
