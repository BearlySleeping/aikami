<script lang="ts">
  // apps/frontend/client/src/lib/views/characters/characters_view.svelte
  import type { CharactersViewModelInterface } from './characters_view_model.svelte';

  type Props = {
    viewModel: CharactersViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<div class="flex flex-col items-center min-h-screen bg-base-200">
  <!-- ═══════════════════════════════════════════════════════════════════
       Header with Back button
       ═══════════════════════════════════════════════════════════════════ -->
  <div
    class="w-full flex items-center justify-between px-6 py-4 bg-base-100 border-b border-base-300"
  >
    <button class="btn btn-ghost btn-sm gap-2" onclick={() => viewModel.goBack()}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
    <h1 class="text-xl font-bold">My Characters</h1>
    <div class="w-20"></div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════
       Main Content
       ═══════════════════════════════════════════════════════════════════ -->
  <div class="w-full max-w-3xl p-6 flex flex-col gap-4">
    <!-- Count + Create -->
    <div class="flex items-center justify-between">
      <p class="text-base-content/60 text-sm">
        {viewModel.characters.length}
        character{viewModel.characters.length !== 1 ? 's' : ''}
        saved
      </p>
      <button class="btn btn-primary btn-sm" onclick={() => viewModel.createCharacter()}>
        + New Character
      </button>
    </div>

    <!-- Empty State -->
    {#if viewModel.isEmpty}
      <div class="card bg-base-100 shadow">
        <div class="card-body items-center py-16 gap-4">
          <p class="text-4xl">🐉</p>
          <h2 class="text-lg font-semibold">No characters yet</h2>
          <p class="text-base-content/60 text-sm text-center max-w-sm">
            Create your first D&D character to begin your adventure.
          </p>
          <button class="btn btn-primary mt-2" onclick={() => viewModel.createCharacter()}>
            Create Character
          </button>
        </div>
      </div>
    {:else}
      <!-- Character List -->
      <div class="grid gap-3">
        {#each viewModel.characters as char (char.persona.id)}
          {@const p = char.persona}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <!-- biome-ignore lint/a11y/useSemanticElements: card contains nested Delete button -->
          <div
            class="card bg-base-100 shadow hover:shadow-md transition-shadow cursor-pointer"
            onclick={() => viewModel.selectCharacter({ id: p.id })}
            role="button"
            tabindex="0"
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                viewModel.selectCharacter({ id: p.id });
              }
            }}
          >
            <div class="card-body p-4">
              <div class="flex gap-4">
                <!-- Avatar -->
                <div class="w-20 h-20 rounded-lg bg-base-300 flex-shrink-0 overflow-hidden">
                  {#if char.avatarUrl}
                    <img
                      src={char.avatarUrl}
                      alt={p.name ?? 'Character'}
                      class="w-full h-full object-cover"
                    >
                  {:else}
                    <div class="w-full h-full flex items-center justify-center text-3xl">🐉</div>
                  {/if}
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-lg truncate">
                    {p.name || 'Unnamed Character'}
                  </h3>
                  <div class="flex flex-wrap gap-2 mt-1 text-xs">
                    {#if p.race}
                      <span class="badge badge-sm badge-outline">{p.race}</span>
                    {/if}
                    {#if p.class}
                      <span class="badge badge-sm badge-outline">{p.class}</span>
                    {/if}
                    {#if p.level}
                      <span class="badge badge-sm badge-outline">Lvl {p.level}</span>
                    {/if}
                    {#if p.alignment}
                      <span class="badge badge-sm badge-outline">{p.alignment}</span>
                    {/if}
                  </div>
                  {#if p.background}
                    <p class="text-sm text-base-content/50 mt-2 line-clamp-2">
                      {p.background}
                    </p>
                  {/if}
                  <div class="flex items-center gap-3 mt-2">
                    <span class="text-xs text-base-content/40">
                      Saved {new Date(char.savedAt).toLocaleDateString()}
                    </span>
                    <!-- Delete button with stopPropagation to prevent card click -->
                    <button
                      class="btn btn-xs btn-ghost text-red-400/60 hover:text-red-400"
                      onclick={(e) => {
                        e.stopPropagation();
                        viewModel.deleteCharacter({ id: p.id });
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
