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
    <!-- Death icon -->
    <div class="text-6xl">💀</div>

    <!-- Title -->
    <h1 class="text-4xl font-bold text-error">You Died</h1>

    <!-- Flavor text -->
    <p class="text-base-content/70 text-lg">Your journey has come to an end... for now.</p>

    <!-- Action buttons -->
    <div class="flex gap-4 pt-4">
      <button class="btn btn-primary btn-lg" onclick={onRespawn}>Respawn</button>
      <button class="btn btn-outline btn-lg" onclick={onLoadLastSave}>Load Last Save</button>
    </div>
  </div>
</div>
