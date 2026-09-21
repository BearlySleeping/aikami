<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/interaction_prompt.svelte
//
// Non-modal interaction prompt HUD — shows the contextual action label when the
// player is near an interactable entity.
//
// C-543 PART F: semantic `.hud-prompt` styling (no hardcoded black/white), and
// no entrance animation that delays actionable information. Reduced motion is
// applied globally by the `[data-motion="reduced"]` policy.
//
// Contract: C-327 AC-2, C-543 PART F.

type Props = {
  label: string;
  visible: boolean;
};

const { label, visible }: Props = $props();
</script>

{#if visible}
  <div class="hud-prompt" role="status" aria-live="polite" data-testid="interaction-prompt">
    <span>{label}</span>
  </div>
{/if}
