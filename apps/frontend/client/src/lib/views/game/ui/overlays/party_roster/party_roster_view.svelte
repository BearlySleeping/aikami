<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view.svelte
//
// C-543 PART B — one CONTENT presentation shared by the standalone modal and the
// management workspace. The workspace header/Return action belong to the host, so
// no duplicate title or Close is rendered there. The "Dismiss companion?"
// confirmation stays a genuine nested modal: it is a separate user decision.
import type { PartyRosterViewModelInterface } from './party_roster_view_model.svelte';

type Props = {
  viewModel: PartyRosterViewModelInterface;
};

const { viewModel }: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  {#snippet children()}
    {#snippet partyBody()}
      <div class="flex min-h-0 w-full flex-1 flex-col">
        {#if viewModel.hasEquipmentNotice}
          <div
            class="alert alert-info mb-3 py-2"
            role="status"
            data-testid="party-equipment-notice"
          >
            <span class="text-sm">{viewModel.equipmentNotice}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={() => viewModel.dismissEquipmentNotice()}
            >
              Dismiss
            </button>
          </div>
        {/if}

        {#if viewModel.isEmpty}
          <div
            class="game-surface--inset flex flex-col items-center gap-2 rounded-lg px-4 py-12 text-center"
          >
            <p class="game-section-title">No companions yet</p>
            <p class="game-metadata max-w-sm">
              Companions you recruit while exploring appear here, with their class, level and
              approval. Ask a recruitable NPC to join you to start a party.
            </p>
          </div>
        {:else}
          <!-- Member list -->
          <div class="space-y-3">
            {#each viewModel.members as member (member.npcId)}
              <div class="game-surface--raised rounded-lg p-4">
                <div class="flex items-center gap-3">
                  <!-- Neutral initial avatar (no portrait capability exists yet) -->
                  <div
                    class="flex h-10 w-10 items-center justify-center rounded-full border border-brass/40 bg-ink text-sm font-bold"
                    aria-hidden="true"
                  >
                    {member.classId.charAt(0).toUpperCase()}
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="game-body-text font-semibold truncate">{member.name}</span>
                      <span class="badge badge-sm badge-outline">{member.classId}</span>
                      <span class="game-metadata game-numeric">Lv.{member.level}</span>
                    </div>

                    <!-- Approval bar -->
                    <div class="mt-1">
                      <div class="flex items-center gap-2">
                        <span class="game-metadata w-16">Approval</span>
                        <progress
                          class="progress flex-1 {viewModel.approvalBarClass(member.approval)}"
                          value={member.approval + 100}
                          max="200"
                        ></progress>
                        <span
                          class="game-metadata game-numeric w-8 text-right {viewModel.approvalTextClass(
                          member.approval,
                        )}"
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
                    onclick={() =>
                    viewModel.talkToCompanion({ npcId: member.npcId, name: member.name })}
                  >
                    Talk
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline"
                    onclick={() =>
                    viewModel.viewEquipment({ npcId: member.npcId, name: member.name })}
                    aria-describedby="party-equipment-explainer"
                  >
                    Equipment
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline btn-error"
                    onclick={() =>
                    viewModel.requestDismiss({ npcId: member.npcId, name: member.name })}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            {/each}
            <p id="party-equipment-explainer" class="game-metadata">
              Companion equipment management is not available yet.
            </p>
          </div>
        {/if}

        <!-- Dismiss confirmation modal (genuine nested decision) -->
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
              <h3 class="game-section-title">Dismiss {viewModel.confirmDismissName}?</h3>
              <p class="py-4 game-metadata">
                They will return to their original location. You can recruit them again later.
              </p>
              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onclick={() => viewModel.cancelDismiss()}
                >
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
    {/snippet}

    {#if viewModel.isStandalonePresentation}
      <div
        class={viewModel.overlayClass}
        role="dialog"
        aria-modal="true"
        aria-label="Party Roster"
        tabindex="-1"
        onclick={(event) => viewModel.handleBackdropClick(event)}
        onkeydown={(event) => viewModel.handleKeyDown(event)}
      >
        <div
          class="game-surface game-surface--raised w-full max-w-lg max-h-[80vh] overflow-y-auto p-6"
        >
          <div class="mb-4 flex items-center justify-between">
            <h2 class="game-section-title">
              Party ({viewModel.members.length}/{viewModel.maxSize})
            </h2>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              onclick={() => viewModel.close()}
              aria-label="Close party roster"
            >
              ✕
            </button>
          </div>
          {@render partyBody()}
        </div>
      </div>
    {:else}
      <div class="h-full min-h-0 overflow-y-auto p-4">
        {@render partyBody()}
      </div>
    {/if}
  {/snippet}
</BaseViewModelContainer>
