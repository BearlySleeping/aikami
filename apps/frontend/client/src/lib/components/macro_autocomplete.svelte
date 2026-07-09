<script lang="ts">
  // apps/frontend/client/src/lib/components/macro_autocomplete.svelte
  //
  // Reusable DaisyUI dropdown component for macro autocomplete.
  // Triggers when the user types `{{` in a textarea, filters available
  // macros by the typed fragment, and inserts `{{macroName}}` on selection.

  export type MacroOption = {
    /** Macro name (e.g. 'user', 'char', 'random'). */
    name: string;
    /** Short description. */
    description: string;
    /** Category for grouping. */
    category: string;
  };

  /** All available macros with descriptions. */
  const ALL_MACROS: MacroOption[] = [
    // Identity
    { name: 'user', description: 'User display name', category: 'Identity' },
    { name: 'char', description: 'Character name', category: 'Identity' },
    // Character
    { name: 'description', description: 'Character description', category: 'Character' },
    { name: 'personality', description: 'Character personality', category: 'Character' },
    // Context
    { name: 'scenario', description: 'Current scenario', category: 'Context' },
    { name: 'persona', description: 'User persona', category: 'Context' },
    { name: 'history', description: 'Chat history', category: 'Context' },
    { name: 'message', description: 'User message', category: 'Context' },
    { name: 'other_characters', description: 'Other NPCs present', category: 'Context' },
    { name: 'getcontext', description: 'Extra context by key', category: 'Context' },
    // Time
    { name: 'time', description: 'Current time', category: 'Time' },
    { name: 'date', description: 'Current date', category: 'Time' },
    { name: 'datetime', description: 'Current date & time', category: 'Time' },
    { name: 'timestamp', description: 'Unix timestamp', category: 'Time' },
    // Random
    { name: 'random', description: 'Random option selection', category: 'Random' },
    { name: 'dice', description: 'Dice roll', category: 'Random' },
    // Variables
    { name: 'setvar', description: 'Set variable', category: 'Variables' },
    { name: 'getvar', description: 'Get variable', category: 'Variables' },
    { name: 'incvar', description: 'Increment variable', category: 'Variables' },
    { name: 'decvar', description: 'Decrement variable', category: 'Variables' },
    // Formatting
    { name: 'trim', description: 'Trim whitespace', category: 'Formatting' },
    { name: 'uppercase', description: 'Convert to uppercase', category: 'Formatting' },
    { name: 'lowercase', description: 'Convert to lowercase', category: 'Formatting' },
  ];

  type Props = {
    /** The trigger text typed so far (e.g. 'us' from '{{us'). */
    trigger: string;
    /** Callback when a macro is selected. */
    onselect: (name: string) => void;
    /** Callback to close/dismiss the autocomplete. */
    onclose: () => void;
  };

  let { trigger, onselect, onclose }: Props = $props();

  /** Filtered macros matching the trigger. */
  const filtered = $derived(
    trigger.length > 0
      ? ALL_MACROS.filter((m) => m.name.toLowerCase().startsWith(trigger.toLowerCase()))
      : ALL_MACROS,
  );

  /** Categorized filtered list. */
  const categories = $derived.by(() => {
    const map = new Map<string, MacroOption[]>();
    for (const macro of filtered) {
      const existing = map.get(macro.category);
      if (existing) {
        existing.push(macro);
      } else {
        map.set(macro.category, [macro]);
      }
    }
    return Array.from(map.entries());
  });
</script>

{#if filtered.length > 0}
  <div class="dropdown dropdown-open">
    <div
      class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-72 z-50 max-h-64 overflow-y-auto"
    >
      {#each categories as [ category, macros ]}
        <span
          class="menu-title text-xs uppercase tracking-wider text-base-content/40 px-3 pt-2 pb-1"
          >{category}</span
        >
        {#each macros as macro}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-base-200 rounded-lg w-full text-left"
            onclick={() => {
              onselect(macro.name);
              onclose();
            }}
          >
            <code class="font-mono text-primary text-xs">&#123;&#123;{macro.name}&#125;&#125;</code>
            <span class="text-base-content/50 text-xs truncate">{macro.description}</span>
          </button>
        {/each}
      {/each}
    </div>
  </div>
{/if}
