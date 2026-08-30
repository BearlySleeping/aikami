<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view.svelte
import type { PartyRosterViewModelInterface } from './party_roster_view_model.svelte';

type Props = {
  viewModel: PartyRosterViewModelInterface;
};

const { viewModel }: Props = $props();

/** Progress-bar color for an approval value. */
const approvalBarClass = (approval: number): string => {
  if (approval > 0) {
    return 'progress-success';
  }
  if (approval < 0) {
    return 'progress-error';
  }
  return 'progress-neutral';
};

/** Text color for an approval value. */
const approvalTextClass = (approval: number): string => {
  if (approval > 0) {
    return 'text-success';
  }
  if (approval < 0) {
    return 'text-error';
  }
  return '';
};
</script>
<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Party Roster"
    tabindex="-1"
    onclick={(event: MouseEvent) => viewModel.handleBackdropClick(event)}
    onkeydown={(event: KeyboardEvent) => viewModel.handleKeyDown(event)}
  >
    <div class="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl p-6">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">Party ({viewModel.members.length}/{viewModel.maxSize})</h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          onclick={() => viewModel.close()}
          aria-label="Close party roster"
        >
          ✕
        </button>
      </div>

      {#if viewModel.isEmpty}
        <div class="text-center text-base-content/50 py-8">
          <p class="text-lg">No companions</p>
          <p class="text-sm mt-1">
            Find recruitable NPCs in the world and ask them to join your party.
          </p>
        </div>
      {:else}
        <!-- Member list -->
        <div class="space-y-3">
          {#each viewModel.members as member (member.npcId)}
            <div class="card bg-base-200 shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center gap-3">
                  <!-- Class icon placeholder -->
                  <div
                    class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold"
                  >
                    {member.classId.charAt(0).toUpperCase()}
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-semibold truncate">{member.name}</span>
                      <span class="badge badge-sm badge-outline">{member.classId}</span>
                      <span class="text-xs text-base-content/50">Lv.{member.level}</span>
                    </div>

                    <!-- Approval bar -->
                    <div class="mt-1">
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-base-content/50 w-16">Approval</span>
                        <progress
                          class="progress flex-1 {approvalBarClass(member.approval)}"
                          value={member.approval + 100}
                          max="200"
                        ></progress>
                        <span
                          class="text-xs font-mono w-8 text-right {approvalTextClass(member.approval)}"
                        >
                          {member.approval > 0 ? '+' : ''}{member.approval}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="flex gap-2 mt-3">
                  <button
                    type="button"
                    class="btn btn-sm btn-outline btn-info"
                    onclick={() => viewModel.talkToCompanion({ npcId: member.npcId, name: member.name })}
                  >
                    Talk
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline"
                    onclick={() => viewModel.viewEquipment({ npcId: member.npcId })}
                  >
                    Equipment
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline btn-error"
                    onclick={() => viewModel.requestDismiss({ npcId: member.npcId, name: member.name })}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Dismiss confirmation modal -->
      {#if viewModel.showConfirmDismiss}
        <div
          class="modal modal-open"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm dismiss"
          tabindex="-1"
          onkeydown={(event: KeyboardEvent) => viewModel.handleDismissKeyDown(event)}
        >
          <div class="modal-box">
            <h3 class="text-lg font-bold">Dismiss {viewModel.confirmDismissName}?</h3>
            <p class="py-4 text-sm text-base-content/70">
              They will return to their original location. You can recruit them again later.
            </p>
            <div class="modal-action">
              <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancelDismiss()}>
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-error"
                onclick={() => viewModel.confirmDismiss()}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
