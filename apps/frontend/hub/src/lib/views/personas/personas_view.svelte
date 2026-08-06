<script lang="ts">
  // apps/frontend/hub/src/lib/views/personas/personas_view.svelte
  import BaseViewModelContainer from '$components/base_view_model_container.svelte';
  import type { PersonasViewModelInterface } from './personas_view_model.svelte.ts';

  type Props = { viewModel: PersonasViewModelInterface };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="flex flex-col gap-6 p-6">
  <div>
    <h1 class="font-display text-2xl text-foreground">Personas</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Browse and manage the personas you have created. One persona can be active at a time.
    </p>
  </div>

  {#if viewModel.errorMessage}
    <div
      class="rounded-md border border-destructive/40 bg-destructive/5 p-4 font-mono text-xs text-destructive"
    >
      {viewModel.errorMessage}
    </div>
  {/if}

  <!-- New persona -->
  <form
    class="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-end"
    onsubmit={(e) => {
      e.preventDefault();
      viewModel.createPersona();
    }}
  >
    <div class="flex-1">
      <label for="persona-name" class="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        New persona name
      </label>
      <input
        id="persona-name"
        type="text"
        value={viewModel.newPersonaName}
        placeholder="e.g. Kaelen, Emberforge Dwarf"
        class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        oninput={(e) => viewModel.setNewPersonaName(e.currentTarget.value)}
      >
    </div>
    <button
      type="submit"
      class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      disabled={viewModel.isCreating || !viewModel.newPersonaName.trim()}
    >
      {viewModel.isCreating ? 'Creating…' : 'Create persona'}
    </button>
  </form>

  <!-- Persona list -->
  {#if viewModel.isLoading}
    <div class="flex justify-center py-12">
      <div
        class="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent"
      ></div>
    </div>
  {:else if viewModel.personas.length === 0}
    <div class="rounded-lg border border-dashed border-border p-10 text-center">
      <p class="text-sm text-muted-foreground">
        You don't have any personas yet. Create your first one above.
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each viewModel.personas as persona (persona.id)}
        <div
          class="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 {persona.isActive
            ? 'border-primary/50 bg-primary/5'
            : ''}"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-3">
              {#if persona.avatarUrl}
                <img
                  src={persona.avatarUrl}
                  alt={persona.name}
                  class="h-10 w-10 shrink-0 rounded-full object-cover"
                >
              {:else}
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-sm text-muted-foreground"
                >
                  {persona.name.slice(0, 1).toUpperCase()}
                </div>
              {/if}
              <div class="min-w-0">
                <div class="truncate font-display text-base text-foreground">{persona.name}</div>
                <div class="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {persona.race}
                  {persona.class}
                  {#if persona.level}· Lvl {persona.level}{/if}
                </div>
              </div>
            </div>
            {#if persona.isActive}
              <span class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
                Active
              </span>
            {/if}
          </div>

          <div class="mt-auto flex gap-2 pt-1">
            {#if !persona.isActive}
              <button
                type="button"
                class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                onclick={() => viewModel.setActivePersona(persona.id)}
              >
                Set active
              </button>
            {:else}
              <span class="px-3 py-1.5 text-xs text-muted-foreground">Active persona</span>
            {/if}
            <button
              type="button"
              class="ml-auto rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5"
              onclick={() => viewModel.deletePersona(persona.id)}
            >
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</BaseViewModelContainer>
