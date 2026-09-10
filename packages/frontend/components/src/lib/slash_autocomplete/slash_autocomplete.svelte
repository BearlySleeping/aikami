<script lang="ts">
// packages/frontend/components/src/lib/slash_autocomplete/slash_autocomplete.svelte

type Completion = {
  name: string;
  description: string;
};

type Props = {
  show: boolean;
  completions: readonly Completion[];
  selectedIndex: number;
  onselect: (index: number) => void;
};

let { show, completions, selectedIndex, onselect }: Props = $props();
</script>

{#if show}
  <div class="relative">
    <ul
      class="menu menu-sm bg-base-200 rounded-lg shadow-lg border border-base-300 absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto z-40"
      data-testid="dialogue-slash-autocomplete-menu"
    >
      {#each completions as command, index (command.name)}
        <li>
          <button
            type="button"
            class:menu-active={index === selectedIndex}
            onmousedown={(event) => {
              event.preventDefault();
              onselect(index);
            }}
            onclick={() => onselect(index)}
          >
            <span class="font-mono font-bold">/{command.name}</span>
            <span class="text-xs text-base-content/50">{command.description}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
