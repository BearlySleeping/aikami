<script lang="ts">
  // apps/frontend/client/src/lib/components/chat/message_action_bar.svelte
  //
  // Hover-visible inline action bar for chat message bubbles.
  // Context-appropriate buttons: AI messages show copy/retry/speak/branch;
  // user messages show copy/edit/delete/branch.
  //
  // Contract: C-231 AC-3 Inline Message Action Bar

  import type { MessageAction } from '$types/rich_chat';

  type Props = {
    /** Message sender — controls which actions are shown. */
    sender: 'user' | 'ai' | 'system';
    /** Whether TTS is available (controls speak button visibility). */
    ttsAvailable?: boolean;
    /** Called when an action is clicked. */
    onAction: (action: MessageAction) => void;
  };

  const { sender, ttsAvailable = false, onAction }: Props = $props();

  /** Actions available for AI messages. */
  const AI_ACTIONS: MessageAction[] = ['copy', 'retry', 'branch'];
  /** Actions available for user messages. */
  const USER_ACTIONS: MessageAction[] = ['copy', 'edit', 'delete', 'branch'];
  /** Actions when TTS is available (added to both). */
  const TTS_ACTION: MessageAction = 'speak';

  const actions = $derived(
    sender === 'ai' ? (ttsAvailable ? [...AI_ACTIONS, TTS_ACTION] : AI_ACTIONS) : USER_ACTIONS,
  );

  /** Labels for action buttons. */
  const LABELS: Record<MessageAction, string> = {
    copy: 'Copy',
    retry: 'Retry',
    edit: 'Edit',
    delete: 'Delete',
    branch: 'Branch',
    speak: 'Speak',
  };

  /** Icons for action buttons. */
  const ICONS: Record<MessageAction, string> = {
    copy: '📋',
    retry: '🔄',
    edit: '✏️',
    delete: '🗑️',
    branch: '🌿',
    speak: '🔊',
  };
</script>

<div
  class="message-action-bar absolute -top-8 right-0 flex gap-1 rounded-lg bg-base-200/90 px-1 py-0.5 opacity-0 shadow backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100"
>
  {#each actions as action (action)}
    <button
      type="button"
      class="btn btn-ghost btn-xs tooltip tooltip-top px-1"
      data-tip={LABELS[action]}
      onclick={(e) => {
        e.stopPropagation();
        onAction(action);
      }}
      aria-label={LABELS[action]}
    >
      <span class="text-xs">{ICONS[action]}</span>
    </button>
  {/each}
</div>
