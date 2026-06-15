<script lang="ts">
  // apps/frontend/client/src/lib/components/mode_indicator.svelte

  import { getPublicMode, isDevelopmentModePublic } from '@aikami/frontend/configs';

  /**
   * Whether the mode indicator is eligible to render.
   * Always false in production.
   */
  const canShow = $derived(isDevelopmentModePublic());

  /** Current mode label. */
  const modeLabel = $derived(getPublicMode() === 'emulator' ? 'Emulator' : 'Staging');

  /** Badge CSS classes per mode. */
  const badgeClass = $derived(
    getPublicMode() === 'emulator'
      ? 'badge-warning text-warning-content'
      : 'badge-info text-info-content',
  );

  /** Whether the indicator is hidden by the user. Resets on each refresh. */
  let hidden = $state(false);

  /** Drag offset from the viewport bottom-right corner. */
  let offsetX = $state(0);
  let offsetY = $state(0);

  let dragging = $state(false);

  /** Dismiss the indicator until next refresh. */
  const hideIndicator = () => {
    hidden = true;
  };

  /**
   * Pointer-drag. Tracks delta from the pointer-down origin so the
   * badge doesn't jump when dragging starts.
   */
  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startOffsetX = offsetX;
    const startOffsetY = offsetY;

    dragging = true;

    const onMove = (moveEvent: PointerEvent) => {
      offsetX = startOffsetX + (moveEvent.clientX - startX);
      offsetY = startOffsetY + (moveEvent.clientY - startY);
    };

    const onUp = () => {
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
</script>

{#if canShow && !hidden}
  <div
    class="fixed z-[9999] select-none"
    style="right: calc(16px - {offsetX}px); bottom: calc(16px - {offsetY}px);"
    role="status"
    aria-label="Running in {modeLabel} mode"
  >
    <div class="flex items-center gap-1 rounded-full shadow-lg backdrop-blur-sm">
      <div
        class="cursor-grab active:cursor-grabbing {dragging ? 'opacity-90' : ''}"
        onpointerdown={onPointerDown}
        role="button"
        tabindex="0"
        style="touch-action: none;"
      >
        <span class="badge badge-sm {badgeClass} rounded-full px-2 py-0.5 text-xs font-medium">
          {modeLabel}
        </span>
      </div>
      <button
        class="btn btn-ghost btn-xs btn-circle -ml-1"
        onclick={hideIndicator}
        aria-label="Hide mode indicator"
      >
        ✕
      </button>
    </div>
  </div>
{/if}
