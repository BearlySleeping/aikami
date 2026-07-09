<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/overlays/game_over_overlay.svelte
  type Props = {
    onRespawn: () => void;
    onLoadLastSave: () => void;
  };

  const { onRespawn, onLoadLastSave }: Props = $props();
</script>

<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/90 backdrop-blur-sm"
>
  <div class="flex flex-col items-center gap-6 rounded-2xl bg-base-200 p-10 shadow-2xl">
    <div class="text-6xl">💀</div>
    <h1 class="text-3xl font-bold text-error">Defeated</h1>
    <p class="text-center text-base text-base-content/60">Your journey ends here... for now.</p>
    <div class="flex gap-4">
      <button type="button" class="btn btn-primary" onclick={onRespawn}>Respawn</button>
      <button type="button" class="btn btn-outline" onclick={onLoadLastSave}>Load Last Save</button>
    </div>
  </div>
</div>
