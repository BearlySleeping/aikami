<script lang="ts">
// apps/frontend/client/src/lib/components/chat/DiceRollPanel.svelte
type Props = {
  isOpen?: boolean;
  onRollPerception?: () => void;
  onRollPersuasion?: () => void;
  history?: Array<{ type: string; roll: number; total: number; timestamp: Date }>;
  onClose?: () => void;
};

let { isOpen = false, onRollPerception, onRollPersuasion, history = [], onClose }: Props = $props();

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

{#if isOpen}
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body p-4">
      <div class="flex justify-between items-center">
        <h3 class="card-title text-sm">Dice Rolls</h3>
        <button type="button" class="btn btn-xs btn-ghost" onclick={onClose}>✕</button>
      </div>

      <div class="flex gap-2 mt-2">
        <button type="button" class="btn btn-sm btn-outline" onclick={onRollPerception}>
          👁️ Perception
        </button>
        <button type="button" class="btn btn-sm btn-outline" onclick={onRollPersuasion}>
          💬 Persuasion
        </button>
      </div>

      {#if history.length > 0}
        <div class="mt-2 max-h-32 overflow-y-auto">
          <div class="text-xs opacity-70 mb-1">Roll History</div>
          {#each history.slice().reverse() as roll}
            <div class="text-xs bg-base-300 p-1 rounded mb-1">
              {roll.type}: {roll.roll} = {roll.total}
              <span class="opacity-50">{formatTime(roll.timestamp)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
