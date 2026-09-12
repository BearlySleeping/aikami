<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_party_rail.svelte
//
// Persistent party surface: real rosters with HP/conditions and the active
// actor. Selecting an actor opens the shared inspector in the Codex.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<aside
  class="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-brass/20 bg-ink p-3"
  aria-label="Party"
  data-testid="obsidian-party-rail"
>
  <div class="flex items-center justify-between">
    <h2 class="font-display text-xs uppercase tracking-widest text-brass">Party</h2>
    <button
      type="button"
      class="text-xs text-base-content/50 underline-offset-2 hover:underline"
      onclick={() => viewModel.openCodex('party')}
    >
      Manage
    </button>
  </div>

  <ul class="flex flex-col gap-2">
    {#each viewModel.partyRows as row (row.id)}
      <li>
        <button
          type="button"
          class="w-full rounded-lg border p-2 text-left transition-colors hover:bg-elevated"
          class:border-primary={row.isActive}
          class:bg-elevated={row.isActive}
          class:border-transparent={!row.isActive}
          data-testid="party-row-{row.id}"
          onclick={() => viewModel.selectActor(row.id)}
        >
          <div class="flex items-center gap-2">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brass/40 font-display text-sm text-base-content"
              style="background: oklch(0.34 0.06 {row.hue})"
              aria-hidden="true"
            >
              {row.name.slice(0, 1)}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1">
                <span class="truncate text-sm font-semibold text-base-content">{row.name}</span>
                {#if row.isPlayer}
                  <span class="text-[10px] uppercase tracking-wide text-brass">You</span>
                {/if}
                {#if row.isActive}
                  <span
                    class="ml-auto inline-block h-2 w-2 rounded-full bg-primary"
                    title="Active actor"
                  ></span>
                {/if}
              </span>
              <span class="block truncate text-xs text-base-content/50">{row.role}</span>
            </span>
          </div>

          <div class="mt-2 flex items-center gap-2">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-base-300">
              <div
                class="h-full rounded-full"
                class:bg-success={row.hpTone === 'success'}
                class:bg-warning={row.hpTone === 'warning'}
                class:bg-error={row.hpTone === 'danger'}
                style="width: {row.hpPercent}%"
              ></div>
            </div>
            <span class="text-xs tabular-nums text-base-content/60">{row.hp}/{row.maxHp}</span>
          </div>

          {#if row.conditionLabels.length > 0}
            <div class="mt-1 flex flex-wrap gap-1">
              {#each row.conditionLabels as label (label)}
                <span class="rounded bg-error/15 px-1.5 py-0.5 text-[10px] text-error"
                  >{label}</span
                >
              {/each}
            </div>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</aside>
