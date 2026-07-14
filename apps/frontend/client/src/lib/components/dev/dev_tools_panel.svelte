<script lang="ts">
// apps/frontend/client/src/lib/components/dev/dev_tools_panel.svelte
//
// Floating, collapsible Dev Tools overlay for (dev) sandbox routes.
// Accepts generic actions (buttons) and toggles (checkboxes).
// NEVER import this file from production code or non-(dev) routes.

import type { DevAction, DevToggle } from '$types';

type Props = {
  /** Action buttons to render. */
  readonly actions?: readonly DevAction[];
  /** Toggle switches to render. */
  readonly toggles?: readonly DevToggle[];
};

const { actions = [], toggles = [] }: Props = $props();

// ── State ─────────────────────────────────────────────────────────────

let collapsed = $state(false);
</script>

<div
  class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 transition-all duration-200"
  class:min-w-64={!collapsed}
  class:min-w-14={collapsed}
>
  <!-- ═══ Header / Collapse toggle ═══ -->
  <button
    type="button"
    class="btn btn-sm gap-2 bg-neutral text-neutral-content border-none shadow-lg hover:bg-neutral-focus flex-nowrap"
    onclick={() => (collapsed = !collapsed)}
    title={collapsed ? 'Expand Dev Tools' : 'Collapse Dev Tools'}
  >
    <span class="text-base">🛠️</span>
    {#if !collapsed}
      <span class="font-mono text-xs font-bold tracking-wide">DEV TOOLS</span>
      <span class="text-xs opacity-50">▼</span>
    {:else}
      <span class="text-xs opacity-50">▲</span>
    {/if}
  </button>

  <!-- ═══ Panel body ═══ -->
  {#if !collapsed}
    <div
      class="flex flex-col gap-3 bg-neutral text-neutral-content rounded-box p-4 shadow-xl border border-neutral/50"
    >
      <!-- ═══ Actions ═══ -->
      {#if actions.length > 0}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-mono opacity-50 uppercase tracking-wider mb-1">Actions</span>
          {#each actions as action}
            <button
              type="button"
              data-testid={`dev-action-${action.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
              class="btn btn-sm btn-ghost justify-start text-neutral-content hover:bg-base-300/30"
              onclick={action.onClick}
            >
              <span class="text-xs mr-1">▶</span>
              {action.label}
            </button>
          {/each}
        </div>
      {/if}

      <!-- ═══ Toggles ═══ -->
      {#if toggles.length > 0}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-mono opacity-50 uppercase tracking-wider mb-1">Toggles</span>
          {#each toggles as toggle}
            <!-- biome-ignore lint/a11y/noLabelWithoutControl: label wraps checkbox input with text -->
            <label
              class="flex items-center gap-2 cursor-pointer hover:bg-base-300/30 px-2 py-1 rounded"
            >
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                onchange={(e) => {
                  const target = e.target as HTMLInputElement;
                  toggle.onChange(target.checked);
                }}
              >
              <span class="text-xs text-neutral-content/80">{toggle.label}</span>
            </label>
          {/each}
        </div>
      {/if}

      <!-- ═══ Empty state ═══ -->
      {#if actions.length === 0 && toggles.length === 0}
        <p class="text-xs text-neutral-content/40 italic px-1">No actions or toggles registered.</p>
      {/if}
    </div>
  {/if}
</div>
