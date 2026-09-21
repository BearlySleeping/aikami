<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/starter_hero_card.svelte
//
// Illustrated starter hero card — the primary affordance of character
// creation. Renders a REAL LPC portrait (from the hero's C-504 appearance
// identity) instead of a placeholder emoji or empty frame, so a preset
// visibly reads as "ready" (C-498 AC-1/AC-3).
//
// Contract: C-498 A preset means the character is ready

import type { StarterHero } from '@aikami/constants';
import { BaseViewModelContainer } from '$components';
import {
  getStarterHeroCardViewModel,
  type StarterHeroCardViewModelInterface,
} from './starter_hero_card_view_model.svelte';

type Props = {
  hero: StarterHero;
  onclick: () => void;
  viewModel?: StarterHeroCardViewModelInterface;
};

const {
  hero,
  onclick,
  viewModel = getStarterHeroCardViewModel({
    className: 'StarterHeroCardViewModel',
    hero,
    onclick,
  }),
}: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="contents">
  <button
    type="button"
    class="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer border border-base-300 text-left w-full group"
    onclick={() => viewModel.select()}
    aria-label={viewModel.ariaLabel}
  >
    <div class="card-body gap-2 p-5">
      <!-- Real LPC portrait — no placeholder emoji -->
      <div
        class="w-full h-32 rounded-lg bg-base-300 flex items-center justify-center mb-2 overflow-hidden"
        aria-hidden="true"
      >
        <canvas bind:this={viewModel.canvasElement} width="128" height="128"></canvas>
      </div>

      <h3 class="card-title text-lg font-semibold text-base-content">{viewModel.name}</h3>

      <div class="flex items-center gap-2">
        <span class="badge badge-primary badge-sm">{viewModel.race}</span>
        <span class="badge badge-secondary badge-sm">{viewModel.characterClass}</span>
      </div>

      <p class="text-sm text-base-content/70 mt-1">{viewModel.flavorText}</p>

      <div class="flex items-center gap-1 text-xs text-base-content/50 mt-2">
        <span>{viewModel.alignment}</span>
      </div>
    </div>
  </button>
</BaseViewModelContainer>
