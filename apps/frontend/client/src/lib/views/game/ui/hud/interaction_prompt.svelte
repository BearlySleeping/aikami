<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/interaction_prompt.svelte
//
// Non-modal interaction prompt HUD — shows "[Key] — Action Verb"
// when the player is near an interactable entity.
// Contract: C-327 AC-2

type Props = {
  label: string;
  visible: boolean;
  reducedMotion: boolean;
};

const { label, visible, reducedMotion }: Props = $props();
</script>

{#if visible}
  <div
    class="interaction-prompt {reducedMotion ? 'no-animation' : ''}"
    role="status"
    aria-live="polite"
  >
    <span class="prompt-key-label">{label}</span>
  </div>
{/if}

<style>
.interaction-prompt {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 0.5rem 1.25rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  pointer-events: none;
  z-index: 100;
}

.interaction-prompt:not(.no-animation) {
  animation: prompt-fade-in 0.2s ease-out;
}

.prompt-key-label {
  letter-spacing: 0.05em;
}

@keyframes prompt-fade-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
