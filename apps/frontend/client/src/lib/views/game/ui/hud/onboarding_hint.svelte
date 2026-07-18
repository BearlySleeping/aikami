<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte
//
// Non-modal onboarding hint toast — shows tutorial hints contextually.
// Dismisses when the taught action is performed or the player clicks dismiss.
// Contract: C-327 AC-3

type Props = {
  text: string | undefined;
  visible: boolean;
  reducedMotion: boolean;
  onDismiss(): void;
};

const { text, visible, reducedMotion, onDismiss }: Props = $props();
</script>

{#if visible && text}
  <div
    class="onboarding-hint {reducedMotion ? 'no-animation' : ''}"
    role="status"
    aria-live="polite"
  >
    <span class="hint-text">{text}</span>
    <button
      class="hint-dismiss"
      onclick={() => onDismiss()}
      aria-label="Dismiss hint"
      type="button"
    >
      ✕
    </button>
  </div>
{/if}

<style>
.onboarding-hint {
  position: absolute;
  top: 4rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 20, 30, 0.92);
  color: #e2e8f0;
  padding: 0.625rem 1.5rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 24rem;
  pointer-events: auto;
  z-index: 101;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.onboarding-hint:not(.no-animation) {
  animation: hint-slide-in 0.3s ease-out;
}

.hint-text {
  flex: 1;
  line-height: 1.4;
}

.hint-dismiss {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 1rem;
  padding: 0.125rem 0.25rem;
  line-height: 1;
}

.hint-dismiss:hover {
  color: #fff;
}

@keyframes hint-slide-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
