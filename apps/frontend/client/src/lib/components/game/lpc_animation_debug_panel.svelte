<script lang="ts">
import type { LpcAnimationState, LpcDirection } from '@aikami/lpc';
// apps/frontend/client/src/lib/components/game/lpc_animation_debug_panel.svelte
//
// Reusable LPC animation debug controls: state + direction dropdowns and a
// playback ticker deck (play/pause, step prev/next, speed, frame scrub).
// Bound to any controller implementing LpcAnimationDebugController —
// shared by /dev/lpc (LpcViewModel) and /dev/lpc-inventory
// (LpcPreviewViewModel).
import type { LpcAnimationDebugController } from './lpc_animation_debug_controller';

type Props = {
  controller: LpcAnimationDebugController;
};

let { controller }: Props = $props();
</script>

<fieldset class="border-0 border-b border-base-300 px-4 py-3 m-0 shrink-0">
  <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
    Animation
  </legend>

  <div class="flex gap-2 mb-2">
    <label class="flex flex-col gap-1 text-xs text-base-content/60 flex-1 min-w-0 mb-2">
      State
      <select
        class="select select-sm w-full bg-base-100"
        value={controller.animationState}
        onchange={(e: Event) => {
          const target = e.target as HTMLSelectElement;
          controller.setAnimationState(Number.parseInt(target.value, 10) as unknown as LpcAnimationState);
        }}
      >
        {#each controller.animationStateOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-1 text-xs text-base-content/60 flex-1 min-w-0 mb-2">
      Direction
      <select
        class="select select-sm w-full bg-base-100"
        value={controller.facingDirection}
        onchange={(e: Event) => {
          const target = e.target as HTMLSelectElement;
          controller.setFacingDirection(Number.parseInt(target.value, 10) as unknown as LpcDirection);
        }}
      >
        {#each controller.directionOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <!-- Animation Playback Ticker Deck -->
  <fieldset class="border border-base-300 rounded-lg p-2.5 mt-1 bg-base-300 flex flex-col gap-1.5">
    <legend class="text-[0.7rem] font-semibold text-primary/70 uppercase tracking-wider">
      Playback Ticker
    </legend>

    <div class="flex gap-1.5 items-center">
      <button
        type="button"
        class="btn btn-sm flex-1"
        class:btn-success={!controller.isPlaying}
        class:btn-warning={controller.isPlaying}
        onclick={() => controller.togglePlayback()}
        aria-label={controller.isPlaying ? 'Pause animation' : 'Play animation'}
      >
        {controller.isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      <button
        type="button"
        class="btn btn-ghost btn-sm flex-1"
        onclick={() => controller.stepPrev()}
        disabled={controller.isPlaying}
        aria-label="Step previous frame"
      >
        ◀ Prev
      </button>

      <button
        type="button"
        class="btn btn-ghost btn-sm flex-1"
        onclick={() => controller.stepNext()}
        disabled={controller.isPlaying}
        aria-label="Step next frame"
      >
        Next ▶
      </button>
    </div>

    <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
      Speed: {controller.playbackFps} FPS
      <input
        type="range"
        class="range range-sm range-primary w-full mt-1"
        min="1"
        max="60"
        value={controller.playbackFps}
        oninput={(e: Event) => controller.setPlaybackFps(Number.parseInt((e.target as HTMLInputElement).value, 10))}
      >
    </label>

    <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
      Frame: {controller.animationFrame} / {controller.maxFrame}
      <input
        type="range"
        class="range range-sm range-primary w-full mt-1 disabled:opacity-40"
        min="0"
        value={controller.animationFrame}
        max={controller.maxFrame}
        disabled={controller.isPlaying}
        oninput={(e: Event) => controller.setAnimationFrame(Number.parseInt((e.target as HTMLInputElement).value, 10))}
      >
    </label>
  </fieldset>
</fieldset>
