<script lang="ts">
// apps/frontend/client/src/lib/views/lorebook/lorebook_generator.svelte
//
// AI-powered lorebook entry generator. Textarea for free-form world notes,
// "Generate Entries" button, spinner during LLM call, preview cards for
// generated entries, and "Save All" to confirm.

import type { LorebookEntryInput } from '$types';

type Props = {
  /** Whether the generator is currently making an LLM call. */
  isGenerating: boolean;
  /** Preview entries from the AI generator. */
  generatedEntries: LorebookEntryInput[];
  /** Callback to trigger generation with the world notes. */
  ongenerate: (worldNotes: string) => void;
  /** Callback to save all generated entries. */
  onsave: () => void;
  /** Callback to clear generated entries. */
  onclear: () => void;
};

const {
  isGenerating = false,
  generatedEntries = [],
  ongenerate = () => {},
  onsave = () => {},
  onclear = () => {},
}: Props = $props();

let worldNotes = $state('');
</script>

<div class="flex flex-col gap-3 p-4 border border-base-300 rounded-lg">
  <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">
    AI Entry Generator
  </h3>

  <!-- World notes textarea -->
  <div>
    <span class="label-text text-xs">Paste world notes or lore description</span>
    <textarea
      class="textarea textarea-bordered w-full textarea-sm resize-y min-h-24 font-mono"
      placeholder="The Kingdom of Eldoria is a medieval fantasy realm inhabited by humans, elves, and dwarves. Goblins roam the eastern forests. Dragons guard the northern mountains..."
      bind:value={worldNotes}
    ></textarea>
  </div>

  <!-- Generate button -->
  <div class="flex gap-2">
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={isGenerating || !worldNotes.trim()}
      onclick={() => ongenerate(worldNotes)}
    >
      {#if isGenerating}
        <span class="loading loading-spinner loading-xs"></span>
      {/if}
      Generate Entries
    </button>
  </div>

  <!-- Generated entries preview -->
  {#if generatedEntries.length > 0}
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">
          Generated ({generatedEntries.length})
        </h4>
        <button type="button" class="btn btn-ghost btn-xs" onclick={onclear}>Clear</button>
      </div>

      {#each generatedEntries as entry, i}
        <div class="p-2 border border-base-300 rounded bg-base-200/50">
          <div class="flex flex-wrap gap-1 mb-1">
            {#each entry.keywords as keyword}
              <span class="badge badge-xs">{keyword}</span>
            {/each}
            {#if entry.constant}
              <span class="badge badge-xs badge-info">constant</span>
            {/if}
            <span class="text-xs text-base-content/40 ml-auto"> P{entry.priority ?? 0} </span>
          </div>
          <p class="text-xs text-base-content/80 line-clamp-3">{entry.content}</p>
        </div>
      {/each}

      <button type="button" class="btn btn-success btn-sm" onclick={onsave}>Save All</button>
    </div>
  {:else if !isGenerating && worldNotes.trim()}
    <p class="text-xs text-base-content/40 italic">
      Click "Generate Entries" to extract structured lorebook entries from your notes.
    </p>
  {/if}
</div>
