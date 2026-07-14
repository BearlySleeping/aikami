<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/enriched_log_entry.svelte
// C-234 Combat Enhancement: Dice & Initiative — enriched combat log rendering
//
// Renders a single combat log entry with:
// - Bolded dice totals
// - Advantage/disadvantage icons
// - Damage type color coding
// - Italicized target names
// - Critical hit/miss highlighting
//
// Pure component — zero business logic. All state via $props().

import type { EnrichedCombatLogEntry } from '../types/combat_enhancements.ts';
import { getDamageTypeColor } from '../types/combat_enhancements.ts';

type Props = {
  /** The enriched log entry to render. */
  entry: EnrichedCombatLogEntry;
};

const { entry }: Props = $props();

/** Damage type color class, if applicable. */
const damageColorClass = $derived(
  entry.damageType ? getDamageTypeColor(entry.damageType) : undefined,
);
</script>

<div class="enriched-log-entry text-xs leading-relaxed text-base-content/70">
  {#if entry.isPlainText}
    <!-- Fallback: plain text rendering -->
    <span>{entry.rawText}</span>
  {:else}
    <!-- Dice value — bolded -->
    {#if entry.diceValue !== undefined}
      <span class="font-bold font-mono text-base-content">
        {entry.diceValue}
      </span>
    {/if}

    <!-- Advantage / Disadvantage icons -->
    {#if entry.advantage}
      <span class="mx-0.5 text-success" title="Advantage">⏫</span>
    {/if}
    {#if entry.disadvantage}
      <span class="mx-0.5 text-error" title="Disadvantage">⏬</span>
    {/if}

    <!-- Critical hit / fumble -->
    {#if entry.isCritical}
      <span class="mx-0.5 text-warning font-bold" title="Critical Hit!">🎯</span>
    {/if}
    {#if entry.isFumble}
      <span class="mx-0.5 text-error font-bold" title="Critical Miss!">💥</span>
    {/if}

    <!-- Damage type color coded -->
    {#if entry.damageType}
      <span class="{damageColorClass} mx-0.5 italic font-mono">
        {entry.damageType}
      </span>
    {/if}

    <!-- Damage value -->
    {#if entry.damageValue !== undefined}
      <span class="font-mono text-base-content">[{entry.damageValue} dmg]</span>
    {/if}

    <!-- Target name (italicized) -->
    {#if entry.targetName}
      <span class="italic text-base-content/50">{entry.targetName}</span>
    {/if}
  {/if}
</div>
