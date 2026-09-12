<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_chronicle.svelte
//
// The Chronicle reading rail: the active conversation and its consequential
// events. History filters here are presentation-only and never change the
// message destination.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';
import Composer from './obsidian_composer.svelte';
import MessageRow from './obsidian_message_row.svelte';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<section
  class="flex min-h-0 w-full flex-col border-l border-brass/20 bg-panel md:w-[30rem] md:max-w-[40%] md:shrink-0"
  aria-label="Chronicle"
  data-testid="obsidian-chronicle"
  data-presentation={viewModel.presentationMode}
>
  <header class="flex shrink-0 items-center gap-2 border-b border-brass/20 px-3 py-2">
    <div class="min-w-0">
      <h2 class="font-display text-sm text-base-content">Chronicle</h2>
      <p class="truncate text-xs text-base-content/55">To: {viewModel.recipientLabel}</p>
    </div>
    <div class="ml-auto flex items-center gap-1">
      {#if viewModel.presentationMode === 'focus'}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => viewModel.unfocusConversation()}
        >
          Exit focus
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => viewModel.focusConversation()}
        >
          Focus
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={() => viewModel.openCodex('inventory')}
      >
        Inventory
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label="Close chronicle"
        onclick={() => viewModel.setPresentationMode('exploration')}
      >
        Close
      </button>
    </div>
  </header>

  <div class="flex shrink-0 items-center gap-1 border-b border-brass/10 px-3 py-1.5">
    <span class="text-[10px] uppercase tracking-widest text-base-content/40">Show</span>
    <button
      type="button"
      class="rounded px-1.5 py-0.5 text-xs"
      class:bg-elevated={viewModel.historyFilter === 'all'}
      aria-pressed={viewModel.historyFilter === 'all'}
      onclick={() => viewModel.setHistoryFilter('all')}
    >
      All
    </button>
    <button
      type="button"
      class="rounded px-1.5 py-0.5 text-xs"
      class:bg-elevated={viewModel.historyFilter === 'conversation'}
      aria-pressed={viewModel.historyFilter === 'conversation'}
      onclick={() => viewModel.setHistoryFilter('conversation')}
    >
      Conversation
    </button>
    <button
      type="button"
      class="rounded px-1.5 py-0.5 text-xs"
      class:bg-elevated={viewModel.historyFilter === 'encounter'}
      aria-pressed={viewModel.historyFilter === 'encounter'}
      onclick={() => viewModel.setHistoryFilter('encounter')}
    >
      Encounters
    </button>
  </div>

  {#if viewModel.isCombat}
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-brass/10 bg-ink px-3 py-1.5 text-xs"
      data-testid="combat-economy"
    >
      <span class="text-brass">Round {viewModel.combatRound}</span>
      <span class="text-base-content/60">Action {viewModel.economy.action}</span>
      <span class="text-base-content/60">Bonus {viewModel.economy.bonus}</span>
      <span class="text-base-content/60">Reaction {viewModel.economy.reaction}</span>
      <span class="ml-auto text-base-content/60">
        {viewModel.isPlayerTurn ? 'Your turn' : 'Enemy turn'}
      </span>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="chronicle-transcript">
    {#each viewModel.visibleMessages as entry (entry.id)}
      <MessageRow {viewModel} {entry} />
    {/each}

    {#if viewModel.isStreaming}
      <div class="flex gap-2 py-2" aria-live="polite">
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass/40 bg-elevated font-display text-xs text-base-content/60"
          aria-hidden="true"
        >
          …
        </span>
        <p
          class="max-w-prose whitespace-pre-line text-[0.95rem] leading-relaxed text-base-content/60"
        >
          {viewModel.streamingText}<span class="animate-pulse">▍</span>
        </p>
      </div>
    {/if}
  </div>

  <Composer {viewModel} />
</section>
