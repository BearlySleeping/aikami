<script lang="ts">
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { GroupChatListViewModelInterface } from './group-chat-list-view-model.svelte.ts';

  type Props = {
    viewModel: GroupChatListViewModelInterface;
  };
  const { viewModel }: Props = $props();

  let newGroupName = $state('');
  let selectedCharacters = $state<string[]>([]);
  let showCreateModal = $state(false);

  function toggleCharacter(characterId: string) {
    if (selectedCharacters.includes(characterId)) {
      selectedCharacters = selectedCharacters.filter((id) => id !== characterId);
    } else {
      selectedCharacters = [...selectedCharacters, characterId];
    }
  }

  function handleCreate() {
    if (newGroupName && selectedCharacters.length > 0) {
      viewModel.createGroupChat(newGroupName, selectedCharacters);
      newGroupName = '';
      selectedCharacters = [];
      showCreateModal = false;
    }
  }
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-4">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold">Group Chats</h2>
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>Create Group</button>
    </div>

    {#if viewModel.isLoading}
      <div class="flex justify-center"><span class="loading loading-spinner"></span></div>
    {:else if viewModel.errorMessage}
      <div class="alert alert-error"><span>{viewModel.errorMessage}</span></div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each viewModel.groupChats as groupChat (groupChat.id)}
          <div class="card bg-base-200 hover:bg-base-300 transition-colors">
            <div class="card-body">
              <h3 class="card-title">{groupChat.name}</h3>
              <p class="text-sm">{groupChat.characterIds.length} characters</p>
              <div class="card-actions justify-end mt-2">
                <a href={`/group-chats/${groupChat.id}`} class="btn btn-sm btn-primary">
                  Open Chat
                </a>
                <button
                  class="btn btn-sm btn-error"
                  onclick={() => viewModel.deleteGroupChat(groupChat.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if showCreateModal}
    <dialog class="modal" open>
      <div class="modal-box">
        <h3 class="font-bold text-lg">Create Group Chat</h3>
        <div class="form-control mt-4">
          <label class="label" for="group-name"> <span class="label-text">Group Name</span> </label>
          <input
            id="group-name"
            type="text"
            bind:value={newGroupName}
            placeholder="Enter group name"
            class="input input-bordered w-full"
          >
        </div>
        <div class="form-control mt-4">
          <span class="label-text mb-2">Select Characters</span>
          <div class="max-h-60 overflow-y-auto border rounded-lg p-2">
            {#each viewModel.availableNpcs as npc (npc.id)}
              <label class="flex items-center gap-2 cursor-pointer p-2 hover:bg-base-200">
                <input
                  type="checkbox"
                  checked={selectedCharacters.includes(npc.id)}
                  onchange={() => toggleCharacter(npc.id)}
                  class="checkbox"
                >
                <span>{npc.name}</span>
              </label>
            {/each}
          </div>
        </div>
        <div class="modal-action">
          <button class="btn btn-ghost" onclick={() => (showCreateModal = false)}>Cancel</button>
          <button
            class="btn btn-primary"
            disabled={!newGroupName || selectedCharacters.length === 0}
            onclick={handleCreate}
          >
            Create
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button onclick={() => (showCreateModal = false)}>close</button>
      </form>
    </dialog>
  {/if}
</BaseViewModelContainer>
