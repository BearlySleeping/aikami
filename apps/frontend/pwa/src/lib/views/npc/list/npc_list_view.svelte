<script lang="ts">
  // apps/frontend/pwa/src/lib/views/npc/list/NpcListView.svelte

  import type { NpcData } from '@aikami/types';
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { NpcListViewModelInterface, NpcTab } from './npc_list_view_model.svelte.ts';

  type Props = {
    viewModel: NpcListViewModelInterface;
  };
  const { viewModel }: Props = $props();

  let fileInput: HTMLInputElement;
  let urlInput = $state('');
  let showUrlModal = $state(false);
  let showCreateModal = $state(false);

  // Edit modal state
  let editName = $state('');
  let editRace = $state('');
  let editClass = $state('');
  let editLevel = $state(1);
  let editOccupation = $state('');
  let editPersonality = $state('');
  let editNotes = $state('');
  let editVisibility = $state<'private' | 'public'>('private');
  let isSaving = $state(false);

  async function saveField(field: string, value: unknown) {
    if (isSaving) return;
    isSaving = true;
    try {
      await viewModel.saveNpc({ data: { [field]: value } });
    } finally {
      isSaving = false;
    }
  }

  function openEditForm(npc: NpcData) {
    editName = npc.name || '';
    editRace = npc.race || '';
    editClass = npc.class || '';
    editLevel = npc.level || 1;
    editOccupation = npc.occupation || '';
    editPersonality = npc.personality || '';
    editNotes = npc.notes || '';
    editVisibility = npc.visibility || 'private';
    viewModel.openEditModal({ npc });
  }

  const tabs: { key: NpcTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'mine', label: 'My NPCs' },
    { key: 'public', label: 'Public' },
    { key: 'system', label: 'System' },
  ];

  function getTabCount(tab: NpcTab): number {
    switch (tab) {
      case 'all':
        return viewModel.systemNpcs.length + viewModel.userNpcs.length;
      case 'mine':
        return viewModel.userNpcs.length;
      case 'public':
        return viewModel.publicNpcs.length;
      case 'system':
        return viewModel.systemNpcs.length;
      default:
        return 0;
    }
  }

  function handleFileChange(event: Event) {
    viewModel.handleFileImport({ event });
  }

  function handleUrlSubmit() {
    if (urlInput.trim()) {
      viewModel.handleUrlImport({ url: urlInput.trim() });
      urlInput = '';
      showUrlModal = false;
    }
  }
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-4">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">{t.nonPlayerCharacters()}</h1>
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>Create NPC</button>
    </header>

    <div class="tabs tabs-boxed mb-4">
      {#each tabs as tab}
        <button
          class="tab"
          class:tab-active={viewModel.activeTab === tab.key}
          onclick={() => viewModel.setActiveTab(tab.key)}
        >
          {tab.label}
          <span class="badge badge-sm ml-2">{getTabCount(tab.key)}</span>
        </button>
      {/each}
    </div>

    <div class="mb-4 flex gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => fileInput.click()}>
        Import PNG/JSON
      </button>
      <button class="btn btn-outline btn-sm" onclick={() => (showUrlModal = true)}>
        Import from URL
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".png,.json"
        class="hidden"
        onchange={handleFileChange}
      >
    </div>

    {#if viewModel.isLoading || viewModel.isImporting}
      <div class="flex justify-center py-10">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if viewModel.errorMessage}
      <div class="alert alert-error mb-4"><span>{viewModel.errorMessage}</span></div>
    {:else}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {#each viewModel.npcs as npc (npc.id)}
          <div class="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer">
            <button
              class="w-full text-left"
              onclick={() => viewModel.navigateToChat({ npcId: npc.id })}
            >
              <div class="bg-base-300 relative h-48">
                {#if npc.avatarUrl}
                  <img src={npc.avatarUrl} alt={npc.name} class="h-full w-full object-cover">
                {:else}
                  <div
                    class="flex h-full w-full items-center justify-center text-4xl text-base-content/30"
                  >
                    {npc.name.charAt(0).toUpperCase()}
                  </div>
                {/if}
                {#if npc.creatorUid}
                  <span class="badge badge-secondary absolute bottom-2 left-2"
                    >{npc.visibility === 'public' ? 'Public' : 'Mine'}</span
                  >
                {:else}
                  <span class="badge badge-accent absolute bottom-2 left-2">System</span>
                {/if}
              </div>
              <div class="card-body p-3">
                <h3 class="card-title truncate text-base">{npc.name}</h3>
                <p class="text-sm text-base-content/70">{npc.race} {npc.class} Lv. {npc.level}</p>
                {#if npc.occupation}
                  <p class="text-xs text-base-content/50 truncate">{npc.occupation}</p>
                {/if}
              </div>
            </button>
            {#if !npc.creatorUid}
              <div class="px-3 pb-3 flex gap-2">
                <button
                  class="btn btn-xs btn-outline"
                  onclick={() => viewModel.handleForkNpc({ npcId: npc.id })}
                >
                  Fork
                </button>
              </div>
            {:else}
              <div class="px-3 pb-3 flex gap-2">
                <button class="btn btn-xs btn-outline" onclick={() => openEditForm(npc)}>
                  Edit
                </button>
                <button
                  class="btn btn-xs btn-outline btn-error"
                  onclick={() => viewModel.handleDeleteNpc({ npcId: npc.id })}
                >
                  Delete
                </button>
              </div>
            {/if}
          </div>
        {/each}

        {#if viewModel.npcs.length === 0}
          <div class="col-span-full py-10 text-center text-base-content/50">
            No NPCs found. Create one or import to get started!
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- URL Import Modal -->
  {#if showUrlModal}
    <div class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Import from URL</h3>
        <p class="py-4">Enter a URL to import an NPC from (Chub, Risu, etc.)</p>
        <input
          type="text"
          placeholder="https://chub.ai/characters/..."
          class="input input-bordered w-full"
          bind:value={urlInput}
        >
        <div class="modal-action">
          <button class="btn btn-ghost" onclick={() => (showUrlModal = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={handleUrlSubmit}>Import</button>
        </div>
      </div>
      <div class="modal-backdrop" onclick={() => (showUrlModal = false)}></div>
    </div>
  {/if}

  <!-- Create NPC Modal (Placeholder) -->
  {#if showCreateModal}
    <div class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Create New NPC</h3>
        <p class="py-4">NPC creation form coming soon!</p>
        <div class="modal-action">
          <button class="btn btn-ghost" onclick={() => (showCreateModal = false)}>Close</button>
        </div>
      </div>
      <div class="modal-backdrop" onclick={() => (showCreateModal = false)}></div>
    </div>
  {/if}

  <!-- Edit NPC Modal -->
  {#if viewModel.editingNpc}
    <div class="modal modal-open">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg">Edit NPC</h3>
        <div class="py-4 grid grid-cols-2 gap-4">
          <label class="form-control w-full">
            <span class="label-text">Name</span>
            <input
              type="text"
              bind:value={editName}
              class="input input-bordered w-full"
              onblur={() => saveField('name', editName)}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Occupation</span>
            <input
              type="text"
              bind:value={editOccupation}
              class="input input-bordered w-full"
              onblur={() => saveField('occupation', editOccupation)}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Race</span>
            <input
              type="text"
              bind:value={editRace}
              class="input input-bordered w-full"
              onblur={() => saveField('race', editRace)}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Class</span>
            <input
              type="text"
              bind:value={editClass}
              class="input input-bordered w-full"
              onblur={() => saveField('class', editClass)}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Level</span>
            <input
              type="number"
              bind:value={editLevel}
              class="input input-bordered w-full"
              min="1"
              max="20"
              onblur={() => saveField('level', editLevel)}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Visibility</span>
            <select
              bind:value={editVisibility}
              class="select select-bordered w-full"
              onchange={() => saveField('visibility', editVisibility)}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label class="form-control w-full col-span-2">
            <span class="label-text">Personality (for AI roleplay)</span>
            <textarea
              bind:value={editPersonality}
              class="textarea textarea-bordered w-full"
              rows="3"
              onblur={() => saveField('personality', editPersonality)}
            ></textarea>
          </label>
          <label class="form-control w-full col-span-2">
            <span class="label-text">Notes</span>
            <textarea
              bind:value={editNotes}
              class="textarea textarea-bordered w-full"
              rows="3"
              onblur={() => saveField('notes', editNotes)}
            ></textarea>
          </label>
        </div>
        <div class="modal-action">
          <button class="btn btn-primary" onclick={() => viewModel.closeEditModal()}>Done</button>
        </div>
      </div>
      <div class="modal-backdrop" onclick={() => viewModel.closeEditModal()}></div>
    </div>
  {/if}
</BaseViewModelContainer>
