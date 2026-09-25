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
  anchor: string;
  density: string;
  effectiveScale: number;
  onDismiss(): void;
  onSkip(): void;
};

const {
  text,
  visible,
  stepIndex,
  totalSteps,
  reducedMotion,
  anchor,
  density,
  effectiveScale,
  onDismiss,
  onSkip,
}: Props = $props();
</script>

{#if visible && text}
  <div
    class="hud-onboarding {reducedMotion ? 'no-animation' : ''}"
    data-hud-anchor={anchor}
    data-hud-density={density}
    data-hud-scale={effectiveScale}
    role="status"
    aria-live="polite"
  >
    <div class="hud-onboarding__content">
      <span class="hud-onboarding__text">{text}</span>
      {#if totalSteps > 0}
        <span class="hud-onboarding__progress">Step {stepIndex + 1} of {totalSteps}</span>
      {/if}
    </div>
    <div class="hud-onboarding__actions">
      <button
        class="hud-onboarding__skip"
        onclick={() => onSkip()}
        aria-label="Skip tutorial"
        type="button"
      >
        Skip
      </button>
      <button
        class="hud-onboarding__dismiss"
        onclick={() => onDismiss()}
        aria-label="Dismiss hint"
        type="button"
      >
        ✕
      </button>
    </div>
  </div>
{/if}
