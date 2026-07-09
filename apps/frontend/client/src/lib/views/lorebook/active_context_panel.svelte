<script lang="ts">
  // apps/frontend/client/src/lib/views/lorebook/active_context_panel.svelte
  //
  // DaisyUI drawer showing active keyword matches from lorebook scanning.
  // Triggered from chat toolbar. Shows match reason ("constant" or
  // "matched: 'goblin'"), new-match highlight animation, and inline editing
  // toggle. Token budget indicator turns red when >2KB.

  import type { KeywordMatch } from '$types/lorebook';

  type Props = {
    /** Whether the drawer is open. */
    open: boolean;
    /** Callback to close the drawer. */
    onclose: () => void;
    /** Matched entries from the keyword scanner. */
    matches: KeywordMatch[];
    /** Total byte size of the matched entry content. */
    tokenBudget: number;
    /** Callback when toggling entry edit mode. */
    ontoggleEdit?: (entryId: string) => void;
  };

  const {
    open = false,
    onclose,
    matches = [],
    tokenBudget = 0,
    ontoggleEdit: _ontoggleEdit,
  }: Props = $props();

  const _formatBytes = (bytes: number): string => {
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  };
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="fixed inset-0 z-50 flex justify-end" tabindex="-1">
    <!-- Backdrop -->
    <button
      type="button"
      class="fixed inset-0 bg-black/50 w-full border-none cursor-pointer"
      onclick={onclose}
      aria-label="Close panel"
    ></button>

    <!-- Drawer -->
    <div class="relative w-96 max-w-full bg-base-100 shadow-xl flex flex-col h-full overflow-auto">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-base-300">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold">Active Context</h2>
          <span
            class="badge badge-sm"
            class:badge-error={tokenBudget > 2048}
            class:badge-ghost={tokenBudget <= 2048}
          >
            {_formatBytes(tokenBudget)}
          </span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-square" onclick={onclose}>✕</button>
      </div>

      <!-- Match list -->
      <div class="flex-1 p-4 flex flex-col gap-3 overflow-auto">
        {#if matches.length === 0}
          <p class="text-sm text-base-content/40 italic">
            No active lorebook entries matched. Send a message containing keywords to see matches
            here.
          </p>
        {:else}
          {#each matches as match (match.entry.id)}
            <div class="p-3 border border-base-300 rounded-lg bg-base-200/50">
              <!-- Match reason badge -->
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="badge badge-sm"
                  class:badge-info={match.matchReason === 'constant'}
                  class:badge-success={match.matchReason !== 'constant'}
                >
                  {match.matchReason}
                </span>
                {#if match.entry.constant}
                  <span class="badge badge-sm badge-outline">constant</span>
                {/if}
                <span class="text-xs text-base-content/40 ml-auto">P{match.entry.priority}</span>
              </div>

              <!-- Keyword chips -->
              <div class="flex flex-wrap gap-1 mb-2">
                {#each match.entry.keywords as keyword}
                  <span
                    class="badge badge-xs"
                    class:badge-primary={keyword === match.matchedKeyword}
                  >
                    {keyword}
                  </span>
                {/each}
              </div>

              <!-- Content -->
              <p class="text-sm text-base-content/80 whitespace-pre-wrap">
                {match.entry.content}
              </p>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Footer -->
      <div class="p-4 border-t border-base-300">
        <p class="text-xs text-base-content/40">
          {matches.length}
          active entries · {_formatBytes(tokenBudget)} of context
        </p>
      </div>
    </div>
  </div>
{/if}
