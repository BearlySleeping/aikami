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
import { onDestroy } from 'svelte';
import { buildStarterHeroRecipes } from '$lib/data/starter_hero_recipes';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';

type Props = {
  hero: StarterHero;
  onclick: () => void;
};

const { hero, onclick }: Props = $props();

// Reusable PixiJS preview sub-ViewModel — one small static portrait per card.
const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
  className: 'StarterHeroPortraitPreview',
  width: 128,
  height: 128,
});

let canvasElement: HTMLCanvasElement | undefined = $state(undefined);

$effect(() => {
  if (canvasElement) {
    previewVm.setCanvasElement(canvasElement);
  }
});

$effect(() => {
  void hero.lpcRecipe;
  void hero.paletteOverrides;
  previewVm.setRecipes(buildStarterHeroRecipes(hero));
});

// Initialize Pixi once the canvas is present; recipes are already staged.
$effect(() => {
  if (canvasElement && !previewVm.isReady) {
    void previewVm.initialize();
  }
});

onDestroy(() => {
  void previewVm.dispose();
});
</script>

<button
  type="button"
  class="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer border border-base-300 text-left w-full group"
  {onclick}
  aria-label="Select {hero.name}, {hero.race} {hero.class}"
>
  <div class="card-body gap-2 p-5">
    <!-- Real LPC portrait — no placeholder emoji -->
    <div
      class="w-full h-32 rounded-lg bg-base-300 flex items-center justify-center mb-2 overflow-hidden"
      aria-hidden="true"
    >
      <canvas bind:this={canvasElement} width="128" height="128"></canvas>
    </div>

    <h3 class="card-title text-lg font-semibold text-base-content">{hero.name}</h3>

    <div class="flex items-center gap-2">
      <span class="badge badge-primary badge-sm">{hero.race}</span>
      <span class="badge badge-secondary badge-sm">{hero.class}</span>
    </div>

    <p class="text-sm text-base-content/70 mt-1">{hero.flavorText}</p>

    <div class="flex items-center gap-1 text-xs text-base-content/50 mt-2">
      <span>{hero.alignment}</span>
    </div>
  </div>
</button>
