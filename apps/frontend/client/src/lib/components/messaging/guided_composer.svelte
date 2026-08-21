<script lang="ts">
// apps/frontend/client/src/lib/components/messaging/guided_composer.svelte
//
// Shared composer used by both the chat surface and the in-game dialogue
// overlay (C-424). Owns the auto-resizing textarea, the send affordance and
// the disabled state. It owns NO send logic — it calls back via `onSend`.
//
// Surface-specific controls (TTS toggle, impersonate, …) are passed in via
// the `extras` snippet; choices and chips render above the input via the
// `above` snippet.
//
// Contract: C-424 Unified Message Surfaces
import type { Snippet } from 'svelte';
import AutoResizeTextarea from '$lib/components/chat/auto_resize_textarea.svelte';

type Props = {
  /** Current input text (controlled). */
  value: string;
  /** Called when the user edits the text. */
  onInput(value: string): void;
  /** Called when the user activates send (with the current value). */
  onSend(text: string): void;
  /** Placeholder for the textarea. */
  placeholder?: string;
  /** Disables the textarea (and, unless overridden, the send button). */
  disabled?: boolean;
  /** Whether a send is in flight — shows a spinner in the send button. */
  isSending?: boolean;
  /** Whether the surface is streaming — turns the send button into a cancel. */
  isStreaming?: boolean;
  /** Called when the streaming cancel affordance is activated. */
  onCancel?: () => void;
  /** Explicit send-button disabled state (defaults to `disabled`). */
  sendDisabled?: boolean;
  /** Whether send requires non-empty text (default true; dialogue passes false). */
  requireText?: boolean;
  /** Label for the send button (default 'Send'). */
  sendLabel?: string;
  /** Icon shown in the send button when idle (e.g. '↑'). */
  sendIcon?: string;
  /** Square send button (dialogue style). */
  square?: boolean;
  /** Keydown handler forwarded to the textarea (surface-specific). */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Surface-specific controls rendered beside the send button. */
  extras?: Snippet;
  /** Content rendered above the input (choices, chips). */
  above?: Snippet;
  /** Ref callback when the textarea mounts. */
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
};

const {
  value,
  onInput,
  onSend,
  placeholder = 'Type your message...',
  disabled = false,
  isSending = false,
  isStreaming = false,
  onCancel,
  sendDisabled,
  requireText = true,
  sendLabel = 'Send',
  sendIcon,
  square = false,
  onKeyDown,
  extras,
  above,
  textareaRef,
}: Props = $props();

/** Whether the send affordance is a cancel (streaming with a cancel handler). */
const showCancel = $derived(isStreaming && !!onCancel);

/** Whether the send affordance is enabled (not disabled and has content). */
const canSend = $derived(!(sendDisabled ?? disabled) && (!requireText || value.trim().length > 0));

const handleActivate = () => {
  if (showCancel) {
    onCancel?.();
    return;
  }
  if (canSend) {
    onSend(value);
  }
};
</script>

{#if above}
  {@render above()}
{/if}

<div class="flex items-end gap-2">
  <div class="flex-1">
    <AutoResizeTextarea
      {value}
      onchange={onInput}
      onkeydown={onKeyDown}
      {placeholder}
      {disabled}
      class="w-full"
      {textareaRef}
    />
  </div>

  {#if extras}
    {@render extras()}
  {/if}

  <button
    type="button"
    class="btn btn-sm {square ? 'btn-square' : ''} {showCancel ? 'btn-error' : 'btn-primary'}"
    onclick={handleActivate}
    disabled={!canSend && !showCancel}
    aria-label={showCancel ? 'Cancel' : 'Send'}
  >
    {#if showCancel}
      <span class="text-lg">■</span>
    {:else if isSending}
      <span class="loading loading-spinner loading-xs"></span>
    {:else if sendIcon}
      <span class="text-lg">{sendIcon}</span>
    {:else}
      {sendLabel}
    {/if}
  </button>
</div>
