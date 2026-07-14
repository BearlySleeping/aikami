<script lang="ts">
// apps/frontend/client/src/lib/components/chat/TTSPlayer.svelte
type Props = {
  isPlaying?: boolean;
  currentText?: string;
  isDemo?: boolean;
  onStop?: () => void;
};

let { isPlaying = false, currentText = '', isDemo = false, onStop }: Props = $props();
</script>

{#if isPlaying}
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body p-3">
      <div class="flex items-center gap-2">
        <span class="loading loading-dots loading-sm"></span>
        <span class="text-sm truncate flex-grow">
          {currentText.slice(0, 50)}{currentText.length > 50 ? '...' : ''}
        </span>
        {#if isDemo}
          <span class="badge badge-warning badge-xs">Demo</span>
        {/if}
        <button type="button" class="btn btn-xs btn-error" onclick={onStop}>⏹️ Stop</button>
      </div>
    </div>
  </div>
{/if}
