<script lang="ts">
// apps/frontend/client/src/lib/components/messaging/rich_message_list.svelte
//
// Shared message list used by both the chat surface and the in-game
// dialogue overlay (C-424). Owns the scrollable container, scroll
// anchoring, the empty state and the streaming (aria-busy) indicator.
//
// It owns NO transport, NO AI calls and NO persistence. Each row is
// rendered by the surface via the `renderRow` snippet (typically the
// shared `rich_message_row`), and surface-specific content rendered after
// the messages (typing indicator, CYOA choices, branch selector, …) is
// passed in via the `after` snippet.
//
// Contract: C-424 Unified Message Surfaces
import type { Snippet } from 'svelte';
import type { RichMessage } from '$types';

type Props = {
  /** Rendered rows, keyed by id. */
  messages: RichMessage[];
  /** Renders a single message row. */
  renderRow: (message: RichMessage, index: number) => Snippet;
  /** Content rendered before the messages, inside the scroll container. */
  before?: Snippet;
  /** Content rendered after the messages, inside the scroll container. */
  after?: Snippet;
  /** Empty-state text shown when there are no messages. */
  emptyText?: string;
  /** CSS classes for the scrollable container. */
  containerClass?: string;
  /** Scrollable container element — bound by the parent via bind:this. */
  containerElement?: HTMLDivElement | undefined;
  /** Whether the surface is streaming — sets aria-busy on the container. */
  isStreaming?: boolean;
};

let {
  messages,
  renderRow,
  before,
  after,
  emptyText = 'No messages yet.',
  containerClass = '',
  containerElement = $bindable(),
  isStreaming = false,
}: Props = $props();

// Scroll anchoring — keep the newest message in view when the list grows
// or while the surface is streaming. Only auto-scroll when the user is
// already near the bottom, so a manual scroll position is preserved.
$effect(() => {
  const last = messages[messages.length - 1];
  void last?.text;
  void messages.length;
  void isStreaming;
  if (containerElement) {
    const distanceFromBottom =
      containerElement.scrollHeight - containerElement.scrollTop - containerElement.clientHeight;
    if (distanceFromBottom < 100) {
      containerElement.scrollTop = containerElement.scrollHeight;
    }
  }
});
</script>

<div bind:this={containerElement} class={containerClass} aria-busy={isStreaming}>
  {#if before}
    {@render before()}
  {/if}

  {#if messages.length === 0 && !before}
    <div class="flex items-center justify-center h-full opacity-50">
      <p>{emptyText}</p>
    </div>
  {:else}
    {#each messages as message, i (message.id)}
      {@render renderRow(message, i)}
    {/each}
  {/if}

  {#if after}
    {@render after()}
  {/if}
</div>
