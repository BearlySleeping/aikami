<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_message_row.svelte
//
// Typed timeline rows. Each entry kind has a distinct, related treatment so
// narration, speech, action, roll, consequence, media, events, and failures
// stay legible in one reading column. Rendering a row never executes it.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';
import type { ObsidianTimelineEntry } from '../obsidian_types';
import InlineCheck from './obsidian_inline_check.svelte';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
  entry: ObsidianTimelineEntry;
};

const { viewModel, entry }: Props = $props();
</script>

{#if entry.kind === 'narration'}
  <div class="py-2" data-testid="message-narration">
    <p
      class="max-w-prose whitespace-pre-line font-display text-[1.02rem] leading-relaxed text-base-content/90"
    >
      {entry.text}
    </p>
  </div>
{:else if entry.kind === 'speech'}
  <div
    class="flex gap-2 py-2"
    class:flex-row-reverse={entry.actorId === 'player'}
    data-testid="message-speech"
  >
    <span
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass/40 bg-elevated font-display text-xs text-base-content"
      aria-hidden="true"
    >
      {entry.speaker.slice(0, 1)}
    </span>
    <div class="min-w-0" class:items-end={entry.actorId === 'player'}>
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-semibold text-brass">{entry.speaker}</span>
        {#if entry.altCount > 0}
          <span class="text-[10px] uppercase tracking-wide text-base-content/40">
            rephrased ×{entry.altCount}
          </span>
        {/if}
      </div>
      <p
        class="mt-0.5 max-w-prose whitespace-pre-line rounded-lg border border-base-300/60 bg-elevated px-3 py-2 text-[0.95rem] leading-relaxed text-base-content"
      >
        {entry.text}
      </p>
    </div>
  </div>
{:else if entry.kind === 'action'}
  <div class="py-1.5" data-testid="message-action">
    <p class="text-sm text-base-content/80">
      <span
        class="mr-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary"
      >
        Action
      </span>
      <span class="font-semibold text-base-content">{entry.actorName}</span>
      <span class="text-base-content/70">{entry.text}</span>
    </p>
  </div>
{:else if entry.kind === 'check'}
  <InlineCheck {viewModel} check={entry.check} />
{:else if entry.kind === 'consequence'}
  <div
    class="my-1.5 border-l-2 border-brass/50 pl-3 text-sm text-base-content/80"
    data-testid="message-consequence"
  >
    {entry.text}
  </div>
{:else if entry.kind === 'image'}
  <figure class="my-2" data-testid="message-image">
    <div
      class="flex h-40 w-full max-w-sm items-center justify-center rounded-lg border border-brass/20 bg-ink text-xs text-base-content/40"
      aria-hidden="true"
    >
      {#if entry.status === 'generating'}
        Generating scene image…
      {:else if entry.status === 'failed'}
        Image unavailable
      {:else}
        Scene image
      {/if}
    </div>
    <figcaption class="mt-1 text-xs text-base-content/50">{entry.alt}</figcaption>
  </figure>
{:else if entry.kind === 'event'}
  <div class="my-1.5 flex items-center gap-2 text-xs" data-testid="message-event">
    <span class="badge badge-sm border-brass/40 bg-brass/10 text-brass">{entry.label}</span>
    <span class="text-base-content/70">{entry.text}</span>
  </div>
{:else}
  <div
    class="my-2 flex items-start gap-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm"
    role="alert"
    data-testid="message-error"
  >
    <span class="font-semibold text-error">Generation failed</span>
    <span class="text-base-content/80">{entry.text}</span>
  </div>
{/if}
