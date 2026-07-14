<script lang="ts">
/**
 * Props for the ExampleMessages component.
 * Displays example conversation starters for a character.
 */
type Props = {
  /** Array of example message texts */
  messages: string[];
  /** Name of the character for display */
  characterName?: string;
};

let { messages, characterName = 'Character' }: Props = $props();
</script>

{#if messages.length > 0}
  <div class="bg-base-200 rounded-lg p-3">
    <h4 class="text-xs font-semibold uppercase opacity-70 mb-2">Example Conversations</h4>
    <div class="space-y-2">
      {#each messages.slice(0, 3) as message, i}
        <div class="text-sm">
          <span class="font-medium">{characterName}:</span>
          <span class="opacity-70 ml-1"
            >{message.slice(0, 100)}{message.length > 100 ? '...' : ''}</span
          >
        </div>
      {/each}
    </div>
  </div>
{/if}
