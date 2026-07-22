<script lang="ts">
import type { PersonaData } from '@aikami/types';
// apps/frontend/client/src/routes/(dev)/dev/characters/+page.svelte
import { browser } from '$app/environment';
import { routerService } from '$services';

type SavedCharacter = {
  persona: PersonaData;
  avatarUrl: string;
  savedAt: string;
};

let characters: SavedCharacter[] = $state([]);

if (browser) {
  const stored = localStorage.getItem('aikami-characters');
  if (stored) {
    try {
      characters = JSON.parse(stored) as SavedCharacter[];
    } catch {
      characters = [];
    }
  }
}
</script>

<svelte:head>
  <title>My Characters</title>
</svelte:head>

<div class="flex flex-col items-center min-h-full p-8 gap-6">
  <div class="w-full max-w-3xl">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">My Characters</h1>
        <p class="text-base-content/60 text-sm mt-1">
          {characters.length}
          character{characters.length !== 1 ? 's' : ''}
          saved
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={() => routerService.goToDevRoute('character')}
      >
        + New Character
      </button>
    </div>

    {#if characters.length === 0}
      <div class="card bg-base-200 shadow">
        <div class="card-body items-center py-16 gap-4">
          <p class="text-4xl">🐉</p>
          <h2 class="text-lg font-semibold">No characters yet</h2>
          <p class="text-base-content/60 text-sm text-center max-w-sm">
            Create your first D&D character using the AI-powered character builder.
          </p>
          <button
            type="button"
            class="btn btn-primary mt-2"
            onclick={() => routerService.goToDevRoute('character')}
          >
            Create Character
          </button>
        </div>
      </div>
    {:else}
      <div class="grid gap-4">
        {#each characters as char, i}
          <div class="card bg-base-200 shadow">
            <div class="card-body p-4">
              <div class="flex gap-4">
                <!-- Avatar -->
                <div class="w-20 h-20 rounded-lg bg-base-300 flex-shrink-0 overflow-hidden">
                  {#if char.avatarUrl}
                    <img
                      src={char.avatarUrl}
                      alt={char.persona.name ?? 'Character'}
                      class="w-full h-full object-cover"
                    >
                  {:else}
                    <div class="w-full h-full flex items-center justify-center text-3xl">🐉</div>
                  {/if}
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-lg truncate">
                    {char.persona.name || 'Unnamed Character'}
                  </h3>
                  <div class="flex flex-wrap gap-2 mt-1 text-xs">
                    {#if char.persona.race}
                      <span class="badge badge-sm badge-outline">{char.persona.race}</span>
                    {/if}
                    {#if (char.persona as { class?: string }).class}
                      <span class="badge badge-sm badge-outline"
                        >{(char.persona as { class?: string }).class}</span
                      >
                    {/if}
                    {#if char.persona.level}
                      <span class="badge badge-sm badge-outline">Lvl {char.persona.level}</span>
                    {/if}
                    {#if char.persona.alignment}
                      <span class="badge badge-sm badge-outline">{char.persona.alignment}</span>
                    {/if}
                  </div>
                  {#if char.persona.background}
                    <p class="text-sm text-base-content/50 mt-2 line-clamp-2">
                      {char.persona.background}
                    </p>
                  {/if}
                  <div class="flex items-center gap-3 mt-2">
                    <span class="text-xs text-base-content/40">
                      Saved {new Date(char.savedAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      class="btn btn-xs btn-ghost text-red-400/60 hover:text-red-400"
                      onclick={() => {
                        const updated = characters.filter((_, j) => j !== i);
                        characters = updated;
                        localStorage.setItem('aikami-characters', JSON.stringify(updated));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
