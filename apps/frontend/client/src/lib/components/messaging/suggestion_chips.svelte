<script lang="ts">
// apps/frontend/client/src/lib/components/messaging/suggestion_chips.svelte
//
// Shared suggestion-chip row (C-420). Extracted from the dialogue overlay so
// both the in-game dialogue surface and chat render the SAME choice
// primitive — one affordance, one meaning: "tap it to say that".
//
// This component is deliberately surface-agnostic: it takes an `onSelect`
// callback and makes no assumption about whether a tap auto-sends (dialogue)
// or prefills the composer (chat). Selection semantics are per-surface.
//
// Contract: C-420 One Choice Affordance
import type { NpcSuggestionChip } from '@aikami/types';
import { chipClassFor, chipIconFor } from './suggestion_chips_mapping.ts';

type Props = {
  /** Chips to render. Empty array renders nothing. */
  chips: readonly NpcSuggestionChip[];
  /** Disables every chip (e.g. while streaming). */
  disabled?: boolean;
  /** Called with the tapped chip's id. */
  onSelect(chipId: string): void;
  /** Optional group label rendered above the chip row (C-420 AC-4). */
  label?: string;
};

const { chips, disabled = false, onSelect, label }: Props = $props();
</script>

{#if chips.length > 0}
  {#key chips.map((c) => c.id).join('|')}
    <div class="border-t border-base-content/5 px-4 py-2">
      {#if label}
        <p class="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-base-content/40">
          {label}
        </p>
      {/if}
      <div class="flex flex-wrap gap-1.5" data-testid="suggestion-chips">
        {#each chips as chip (chip.id)}
          <button
            type="button"
            class="btn btn-xs gap-1 normal-case border-base-content/15 {chipClassFor(chip.intentType)}"
            {disabled}
            onclick={() => onSelect(chip.id)}
            aria-label={chip.label}
          >
            <span>{chipIconFor(chip.intentType)}</span>
            {chip.label}
          </button>
        {/each}
      </div>
    </div>
  {/key}
{/if}
