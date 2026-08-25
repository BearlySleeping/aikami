<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte
//
// Non-modal onboarding hint toast — shows tutorial hints contextually
// with step progress and skip affordance.
// Dismisses when the taught action is performed or the player clicks dismiss.
// Contract: C-327 AC-3; C-422 AC-3 (progress + skip)

type Props = {
  text: string | undefined;
  visible: boolean;
  stepIndex: number;
  totalSteps: number;
  reducedMotion: boolean;
  onDismiss(): void;
  onSkip(): void;
};

const { text, visible, stepIndex, totalSteps, reducedMotion, onDismiss, onSkip }: Props = $props();
</script>

{#if visible && text}
  <div
    class="onboarding-hint {reducedMotion ? 'no-animation' : ''}"
    role="status"
    aria-live="polite"
  >
    <div class="hint-content">
      <span class="hint-text">{text}</span>
      {#if totalSteps > 0}
        <span class="hint-progress">Step {stepIndex + 1} of {totalSteps}</span>
      {/if}
    </div>
    <div class="hint-actions">
      <button class="hint-skip" onclick={() => onSkip()} aria-label="Skip tutorial" type="button">
        Skip
      </button>
      <button
        class="hint-dismiss"
        onclick={() => onDismiss()}
        aria-label="Dismiss hint"
        type="button"
      >
        ✕
      </button>
    </div>
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
  max-width: 28rem;
  pointer-events: auto;
  z-index: 101;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.onboarding-hint:not(.no-animation) {
  animation: hint-slide-in 0.3s ease-out;
}

.hint-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.hint-text {
  line-height: 1.4;
}

.hint-progress {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.2;
}

.hint-actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.hint-skip {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.1875rem 0.5rem;
  border-radius: 0.25rem;
  line-height: 1.4;
  transition:
    background 0.15s,
    color 0.15s;
}

.hint-skip:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.hint-skip:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.5);
  outline-offset: 1px;
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
