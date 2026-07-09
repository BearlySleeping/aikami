<script lang="ts">
  // apps/frontend/client/src/lib/views/lorebook/lorebook_editor_view.svelte
  //
  // DaisyUI CRUD form for lorebooks and entries. Pure view — delegates
  // all logic to LorebookEditorViewModel. Supports lorebook list sidebar,
  // entry cards with keyword chips, content textarea, constant toggle,
  // priority input, and inline editing.

  import type { LorebookEditorViewModelInterface } from './lorebook_editor_view_model.svelte';

  type Props = {
    viewModel: LorebookEditorViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full gap-4">
  <!-- ═══ Lorebook list sidebar ═══ -->
  <div class="w-56 shrink-0 flex flex-col gap-2 border-r border-base-300 pr-3 overflow-auto">
    <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">Lorebooks</h3>

    <!-- New lorebook form -->
    <div class="flex flex-col gap-1">
      <input
        type="text"
        class="input input-bordered input-sm"
        placeholder="Lorebook name"
        value={viewModel.lorebookName}
        oninput={(e: Event) => {
          const target = e.target as HTMLInputElement;
          viewModel.setLorebookName(target.value);
        }}
      >
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!viewModel.lorebookName.trim()}
        onclick={() => viewModel.createLorebook()}
      >
        + Create
      </button>
    </div>

    <!-- Lorebook list -->
    {#each viewModel.lorebooks as lb}
      <button
        type="button"
        class="btn btn-sm w-full justify-start text-left {lb.id === viewModel.selectedLorebookId ? 'btn-active' : 'btn-ghost'}"
        onclick={() => viewModel.selectLorebook({ id: lb.id })}
      >
        <span class="truncate">{lb.name}</span>
        <span class="text-xs text-base-content/40 ml-auto">{lb.entries.length}</span>
      </button>
    {/each}

    {#if viewModel.lorebooks.length === 0}
      <p class="text-xs text-base-content/40 italic px-2">No lorebooks yet.</p>
    {/if}
  </div>

  <!-- ═══ Editor panel ═══ -->
  <div class="flex-1 min-w-0 flex flex-col gap-4 overflow-auto">
    {#if viewModel.selectedLorebookId && viewModel.selectedLorebook}
      <!-- Lorebook header -->
      <div class="flex items-center gap-2">
        <input
          type="text"
          class="input input-bordered input-sm flex-1"
          value={viewModel.lorebookName}
          oninput={(e: Event) => {
            const target = e.target as HTMLInputElement;
            viewModel.setLorebookName(target.value);
          }}
          onblur={() => viewModel.updateLorebookName()}
        >
        <button
          type="button"
          class="btn btn-error btn-sm btn-outline"
          onclick={() => viewModel.deleteSelectedLorebook()}
        >
          Delete
        </button>
      </div>

      <!-- Entry form -->
      <div class="flex flex-col gap-2 p-3 border border-base-300 rounded-lg">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">
          {viewModel.editingEntryId ? 'Edit Entry' : 'New Entry'}
        </h4>

        <!-- Keywords input -->
        <div>
          <span class="label-text text-xs">Keywords (comma-separated)</span>
          <input
            type="text"
            class="input input-bordered input-sm w-full font-mono"
            placeholder="goblin, orc, dragon"
            value={viewModel.entryKeywordInput}
            oninput={(e: Event) => {
              const target = e.target as HTMLInputElement;
              viewModel.setEntryKeywordInput(target.value);
            }}
          >
        </div>

        <!-- Content textarea -->
        <div>
          <span class="label-text text-xs">Content</span>
          <textarea
            class="textarea textarea-bordered w-full textarea-sm resize-y min-h-24"
            placeholder="World info content..."
            value={viewModel.entryContent}
            oninput={(e: Event) => {
              const target = e.target as HTMLTextAreaElement;
              viewModel.setEntryContent(target.value);
            }}
          ></textarea>
        </div>

        <!-- Priority + Constant toggle -->
        <div class="flex items-center gap-4">
          <label class="form-control flex-1">
            <span class="label-text text-xs">Priority</span>
            <input
              type="number"
              class="input input-bordered input-sm w-24"
              value={viewModel.entryPriority}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                viewModel.setEntryPriority(Number(target.value));
              }}
            >
          </label>

          <label class="flex items-center gap-2 cursor-pointer pt-4">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={viewModel.entryConstant}
              onchange={() => viewModel.toggleEntryConstant()}
            >
            <span class="text-xs">Constant</span>
          </label>
        </div>

        <!-- Form actions -->
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onclick={() => viewModel.saveEntry()}
          >
            {viewModel.editingEntryId ? 'Update' : 'Add Entry'}
          </button>
          {#if viewModel.editingEntryId}
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={() => viewModel.cancelEditingEntry()}
            >
              Cancel
            </button>
          {/if}
        </div>
      </div>

      <!-- Entry list -->
      <div class="flex flex-col gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">
          Entries ({viewModel.entries.length})
        </h4>

        {#each viewModel.entries as entry}
          <div class="flex flex-col gap-1 p-3 border border-base-300 rounded-lg bg-base-200/50">
            <!-- Keyword chips -->
            <div class="flex flex-wrap gap-1">
              {#if entry.constant}
                <span class="badge badge-info badge-sm">constant</span>
              {/if}
              {#each entry.keywords as keyword}
                <span class="badge badge-sm">{keyword}</span>
              {/each}
              <span class="badge badge-outline badge-sm ml-auto">P{entry.priority}</span>
            </div>

            <!-- Content preview -->
            <p class="text-sm text-base-content/80 line-clamp-2">{entry.content}</p>

            <!-- Entry actions -->
            <div class="flex gap-1 justify-end">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => viewModel.startEditingEntry({ entryId: entry.id })}
              >
                Edit
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs text-error"
                onclick={() => viewModel.deleteEntry({ entryId: entry.id })}
              >
                Delete
              </button>
            </div>
          </div>
        {/each}

        {#if viewModel.entries.length === 0}
          <p class="text-xs text-base-content/40 italic">No entries yet. Add one above.</p>
        {/if}
      </div>
    {:else}
      <!-- Empty state -->
      <div class="flex items-center justify-center h-full">
        <p class="text-base-content/40 italic">
          Select a lorebook from the sidebar or create a new one.
        </p>
      </div>
    {/if}
  </div>
</div>
