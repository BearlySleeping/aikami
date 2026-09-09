<script lang="ts">
// apps/frontend/client/src/lib/components/chat/message_action_bar.svelte
//
// Hover-visible inline action bar for chat message bubbles.
// Context-appropriate buttons: AI messages show copy/retry/speak/branch;
// user messages show copy/edit/delete/branch.
//
// Contract: C-231 AC-3 Inline Message Action Bar, C-490 (gating + "Rephrase")

import type { MessageAction } from '$types';
import { availableMessageActions, messageActionIcon, messageActionLabel } from './message_actions';

type Props = {
  /** Message sender — controls which actions are shown. */
  sender: 'user' | 'ai' | 'system';
  /** Whether TTS is available (controls speak button visibility). */
  ttsAvailable?: boolean;
  /**
   * C-490: when true (campaign play), transcript-rewinding members
   * (branch/edit/delete) are dropped; retry reads "Rephrase".
   */
  disableRewind?: boolean;
  /** Called when an action is clicked. */
  onAction: (action: MessageAction) => void;
};

const { sender, ttsAvailable = false, disableRewind = false, onAction }: Props = $props();

const actions = $derived(availableMessageActions({ sender, ttsAvailable, disableRewind }));
</script>

<div
  class="message-action-bar absolute -top-8 right-0 flex gap-1 rounded-lg bg-base-200/90 px-1 py-0.5 opacity-0 shadow backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100"
>
  {#each actions as action (action)}
    <button
      type="button"
      class="btn btn-ghost btn-xs tooltip tooltip-top px-1"
      data-tip={messageActionLabel(action)}
      onclick={(e) => {
        e.stopPropagation();
        onAction(action);
      }}
      aria-label={messageActionLabel(action)}
    >
      <span class="text-xs">{messageActionIcon(action)}</span>
    </button>
  {/each}
</div>
