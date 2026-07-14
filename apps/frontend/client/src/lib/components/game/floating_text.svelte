<script lang="ts">
// apps/frontend/client/src/lib/components/game/floating_text.svelte
//
// Floating damage text component. Renders red text that floats upward
// and fades out over ~1.2 seconds. Auto-removes via onComplete callback.
//
// Contract: C-163 Visceral Feedback Juice

type Props = {
  /** Damage amount to display. */
  amount: number;
  /** Screen-space X coordinate (CSS pixels). */
  x: number;
  /** Screen-space Y coordinate (CSS pixels). */
  y: number;
  /** Whether this is a critical hit (doubles the text size). */
  isCritical?: boolean;
  /** Called when the animation completes so the parent can remove this instance. */
  onComplete: () => void;
};

const { amount, x, y, isCritical = false, onComplete }: Props = $props();

const handleAnimationEnd = (): void => {
  onComplete();
};
</script>

<div
  class="floating-damage-text pointer-events-none absolute select-none"
  style="left: {x}px; top: {y}px;"
  onanimationend={handleAnimationEnd}
>
  <span
    class="block font-bold drop-shadow-lg"
    class:text-2xl={isCritical}
    class:text-lg={!isCritical}
  >
    -{amount}
  </span>
</div>

<style>
.floating-damage-text {
  animation: float-fade 1.2s ease-out forwards;
  z-index: 999;
  color: #ff3333;
  text-shadow:
    0 0 4px rgba(255, 0, 0, 0.6),
    0 2px 4px rgba(0, 0, 0, 0.8);
}

@keyframes float-fade {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) translateY(0);
  }
  60% {
    opacity: 0.8;
    transform: translate(-50%, -50%) translateY(-30px);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) translateY(-60px);
  }
}
</style>
