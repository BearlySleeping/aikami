<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_composer.svelte
//
// The single composer for every conversation context. Recipient, intent, and
// audience are explicit; switching recipient swaps a scoped draft and never
// sends. Generation verbs stay distinct: Send, Continue, Retry, Rephrase.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="shrink-0 border-t border-brass/20 bg-panel p-3" data-testid="obsidian-composer">
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs uppercase tracking-wide text-base-content/45">To:</span>
    {#each viewModel.recipientOptions as option (option.id)}
      <button
        type="button"
        class="rounded-full border px-2.5 py-1 text-xs"
        class:border-primary={viewModel.recipient === option.id}
        class:bg-primary={viewModel.recipient === option.id}
        class:text-primary-content={viewModel.recipient === option.id}
        class:border-base-300={viewModel.recipient !== option.id}
        aria-pressed={viewModel.recipient === option.id}
        title={option.hint}
        onclick={() => viewModel.setRecipient(option.id)}
      >
        {option.label}
      </button>
    {/each}

    <span class="mx-1 h-4 w-px bg-base-300" aria-hidden="true"></span>

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs"
        class:bg-elevated={viewModel.intentMode === 'say'}
        class:text-base-content={viewModel.intentMode === 'say'}
        class:intent-muted={viewModel.intentMode !== 'say'}
        aria-pressed={viewModel.intentMode === 'say'}
        onclick={() => viewModel.setIntentMode('say')}
      >
        Say
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs"
        class:bg-elevated={viewModel.intentMode === 'act'}
        class:text-base-content={viewModel.intentMode === 'act'}
        class:intent-muted={viewModel.intentMode !== 'act'}
        aria-pressed={viewModel.intentMode === 'act'}
        onclick={() => viewModel.setIntentMode('act')}
      >
        Act
      </button>
    </div>

    <span class="ml-auto text-xs text-base-content/55">{viewModel.audienceLabel}</span>
  </div>

  <label class="mt-2 block">
    <span class="sr-only">Message</span>
    <textarea
      class="textarea textarea-bordered w-full resize-none bg-elevated text-sm leading-relaxed"
      rows="3"
      placeholder="Describe what you say or do…"
      data-testid="composer-input"
      value={viewModel.draft}
      oninput={(event) => viewModel.setDraft(event.currentTarget.value)}
    ></textarea>
  </label>

  {#if viewModel.suggestions.length > 0 && !viewModel.isStreaming}
    <div class="mt-2 flex flex-wrap gap-1.5">
      {#each viewModel.suggestions as suggestion (suggestion.id)}
        <button
          type="button"
          class="rounded-full border border-base-300 px-2 py-0.5 text-xs text-base-content/70 hover:bg-elevated"
          onclick={() => viewModel.applySuggestion(suggestion)}
        >
          {suggestion.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if viewModel.isStreaming}
    <p class="mt-2 flex items-center gap-2 text-xs text-base-content/70" aria-live="polite">
      <span class="text-brass">Mira</span>
      is responding…
    </p>
  {/if}

  <div class="mt-2 flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      onclick={() => viewModel.applySuggestion({ id: 'commands', label: 'Commands', prefill: '/' })}
    >
      Commands /
    </button>
    <button type="button" class="btn btn-ghost btn-xs" onclick={() => viewModel.toggleVoice()}>
      {viewModel.isSpeaking ? 'Voice on' : 'Voice'}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={!viewModel.canContinue}
      onclick={() => void viewModel.continueNarration()}
    >
      Continue
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={!viewModel.canRetry}
      onclick={() => void viewModel.retry()}
    >
      Retry
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={!viewModel.canRephrase}
      onclick={() => viewModel.rephrase()}
    >
      Rephrase
    </button>

    {#if viewModel.isStreaming}
      <button
        type="button"
        class="btn btn-outline btn-xs ml-auto"
        onclick={() => viewModel.cancelStream()}
      >
        Stop
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-primary btn-sm ml-auto"
        disabled={!viewModel.canSend}
        data-testid="composer-send"
        onclick={() => void viewModel.send()}
      >
        Send →
      </button>
    {/if}
  </div>
</div>

<style>
.intent-muted {
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}
</style>
