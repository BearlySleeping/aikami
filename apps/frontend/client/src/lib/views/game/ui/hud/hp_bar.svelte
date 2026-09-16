<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/hp_bar.svelte
//
// C-543 — player status surface.
//
// Dumb presentation only: the percentage, severity tone and labels are
// projected by the game UI ViewModel (`playerStatus`), so "what counts as low
// health" has exactly one owner. The tone is signalled by color AND a text
// label (never color alone), numerals are tabular, and there is no emoji.
// Sizing comes from the game-scoped `.hud-status` classes, which scale through
// `--hud-widget-scale` — no CSS `zoom`, no transform.
//
// Contract: C-543 PART F; C-332 AC-1.

import type { HudPlayerStatus } from '../game_ui_status_projections.ts';

type Props = {
  status: HudPlayerStatus;
  visible: boolean;
};

const { status, visible }: Props = $props();
</script>

{#if visible}
  <div
    class="hud-status hud-status--{status.tone}"
    role="progressbar"
    aria-valuenow={status.hp}
    aria-valuemin={0}
    aria-valuemax={status.maxHp}
    aria-label="Player health: {status.toneLabel}"
    data-testid="player-hud"
  >
    <span class="hud-status__mark" aria-hidden="true"></span>
    <span class="hud-status__track" aria-hidden="true">
      <span class="hud-status__fill" style="inline-size: {status.percent}%"></span>
    </span>
    <span class="hud-status__value game-numeric">{status.valueLabel}</span>
    <span class="hud-status__caption">{status.toneLabel}</span>
  </div>
{/if}
