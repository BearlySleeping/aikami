<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu_overlay.svelte

  type Props = {
    onResume: () => void;
    onSettings: () => void;
    onQuit: () => void;
  };

  const { onResume, onSettings, onQuit }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
  role="dialog"
  aria-label="Pause Menu"
>
  <div class="w-72 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
    <h2 class="text-center text-lg font-bold text-base-content">Paused</h2>

    <div class="mt-6 space-y-3">
      <button class="btn btn-primary btn-block" onclick={onResume}>Resume Game</button>

      <button class="btn btn-outline btn-block" onclick={onSettings}>Settings</button>

      <button class="btn btn-ghost btn-block text-error" onclick={onQuit}>Quit to Main Menu</button>
    </div>

    <p class="mt-4 text-center text-xs text-base-content/50">Press Escape to resume</p>
  </div>
</div>
