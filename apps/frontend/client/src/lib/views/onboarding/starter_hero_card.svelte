<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/starter_hero_card.svelte
import type { StarterHero } from '@aikami/constants';

type Props = {
  hero: StarterHero;
  onclick: () => void;
};

const { hero, onclick }: Props = $props();
</script>

<button
  type="button"
  class="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer border border-base-300 text-left w-full group"
  {onclick}
  aria-label="Select {hero.name}, {hero.race} {hero.class}"
>
  <div class="card-body gap-2 p-5">
    <!-- Placeholder illustration -->
    <div
      class="w-full h-32 rounded-lg bg-base-300 flex items-center justify-center mb-2 group-hover:bg-base-100 transition-colors"
      aria-hidden="true"
    >
      <span class="text-4xl opacity-30">⚔️</span>
    </div>

    <h3 class="card-title text-lg font-semibold text-base-content">
      {hero.name}
    </h3>

    <div class="flex items-center gap-2">
      <span class="badge badge-primary badge-sm">{hero.race}</span>
      <span class="badge badge-secondary badge-sm">{hero.class}</span>
    </div>

    <p class="text-sm text-base-content/70 mt-1">
      {hero.flavorText}
    </p>

    <div class="flex items-center gap-1 text-xs text-base-content/50 mt-2">
      <span>{hero.alignment}</span>
      <span aria-hidden="true">·</span>
      <span>{hero.pronouns.subjective}/{hero.pronouns.objective}</span>
    </div>
  </div>
</button>
