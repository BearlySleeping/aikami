<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/dice_quick_menu.svelte
  // C-234 Combat Enhancement: Dice & Initiative — multi-dice quick menu
  //
  // Reusable component: 8-preset grid (d4–d100, 2d6) + custom notation input
  // + queued badges + Roll All button.
  //
  // Pure component — zero business logic. All state and actions provided
  // via $props().

  import {
    DICE_PRESETS,
    type DiceNotation,
    type QueuedRoll,
  } from '../types/combat_enhancements.ts';

  type Props = {
    /** Currently queued rolls (shown as badges below the grid). */
    queuedRolls: QueuedRoll[];
    /** Callback when a preset or custom dice is queued. */
    onQueueRoll: (options: { notation: DiceNotation; label: string }) => void;
    /** Callback to remove a specific queued roll. */
    onRemoveQueuedRoll: (rollId: string) => void;
    /** Callback to resolve (roll) all queued dice. */
    onRollAll: () => void;
    /** Whether the roll-all button should be disabled. */
    isRolling: boolean;
  };

  const {
    queuedRolls,
    onQueueRoll,
    onRemoveQueuedRoll,
    onRollAll,
    isRolling = false,
  }: Props = $props();

  /** Custom dice notation input (e.g. "3d8", "1d20"). */
  let customInput = $state('');

  /** Validation error for custom input. */
  let customError = $state('');

  /**
   * Queue a custom dice roll from the text input.
   * Validates the notation before queueing.
   */
  const handleCustomQueue = (): void => {
    const trimmed = customInput.trim();
    if (trimmed.length === 0) {
      return;
    }

    // Parse notation using convention — inline parse for component purity
    const match = trimmed.toLowerCase().match(/^(\d+)?d(\d+)$/);
    if (!match) {
      customError = 'Use format: 2d6, d20, 1d100';
      return;
    }

    const count = match[1] ? Number.parseInt(match[1], 10) : 1;
    const sides = Number.parseInt(match[2], 10);

    if (count < 1 || sides < 1) {
      customError = 'Count and sides must be ≥ 1';
      return;
    }

    const label = count === 1 ? `d${sides}` : `${count}d${sides}`;
    const notation: DiceNotation = { count, sides, label };

    customError = '';
    customInput = '';
    onQueueRoll({ notation, label });
  };

  /**
   * Handle keydown on the custom input — Enter to queue.
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCustomQueue();
    }
  };
</script>

<div class="dice-quick-menu rounded-lg border border-base-300 bg-base-200 p-3">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <span class="text-xs font-semibold text-base-content/70">🎲 Quick Dice</span>
    {#if queuedRolls.length > 0}
      <button class="btn btn-primary btn-xs" onclick={onRollAll} disabled={isRolling}>
        {#if isRolling}
          <span class="loading loading-spinner loading-xs"></span>
          Rolling...
        {:else}
          Roll All ({queuedRolls.length})
        {/if}
      </button>
    {/if}
  </div>

  <!-- Preset grid: 4 columns, 2 rows -->
  <div class="mb-2 grid grid-cols-4 gap-1">
    {#each DICE_PRESETS as preset}
      <button
        class="btn btn-outline btn-xs font-mono"
        onclick={() => onQueueRoll({ notation: preset.notation, label: preset.label })}
        disabled={isRolling}
      >
        {preset.label}
      </button>
    {/each}
  </div>

  <!-- Custom notation input -->
  <div class="flex gap-1">
    <input
      type="text"
      bind:value={customInput}
      onkeydown={handleKeyDown}
      placeholder="e.g. 3d8"
      class="input input-bordered input-xs flex-1 font-mono"
      disabled={isRolling}
    >
    <button
      class="btn btn-outline btn-xs"
      onclick={handleCustomQueue}
      disabled={isRolling || customInput.trim().length === 0}
    >
      +Add
    </button>
  </div>

  {#if customError}
    <p class="mt-1 text-xs text-error">{customError}</p>
  {/if}

  <!-- Queued roll badges -->
  {#if queuedRolls.length > 0}
    <div class="mt-2 flex flex-wrap gap-1">
      {#each queuedRolls as roll (roll.id)}
        <div class="badge badge-outline badge-sm gap-1 pr-0 font-mono">
          <span
            >{roll.label}
            {roll.label !== roll.notation.label ? ` (${roll.notation.label})` : ''}</span
          >
          {#if roll.label}
            <span class="text-base-content/40">·</span>
            <span class="text-base-content/60">{roll.label}</span>
          {/if}
          <button
            class="btn btn-ghost btn-xs h-4 min-h-0 w-4 px-0 text-base-content/40 hover:text-error"
            onclick={() => onRemoveQueuedRoll(roll.id)}
            disabled={isRolling}
          >
            ✕
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
