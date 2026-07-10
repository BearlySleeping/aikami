<script lang="ts">
// apps/frontend/client/src/lib/views/settings/autonomous/schedule_editor_view.svelte
//
// Schedule editor — 7-day × 24-hour grid with drag-paint, activity
// editing, and "Generate Schedule" button.
//
// Contract: C-248 Autonomous NPC Behavior Schedules
import type { AvailabilityStatus } from '@aikami/types';
import type { ScheduleEditorViewModelInterface } from './schedule_editor_view_model.svelte';

type Props = {
  viewModel?: ScheduleEditorViewModelInterface;
};

const { viewModel }: Props = $props();

let isDragging = $state(false);
let activityEditingDay = $state<number | undefined>(undefined);
let activityEditingHour = $state<number | undefined>(undefined);

const handleActivityClose = () => {
  activityEditingDay = undefined;
  activityEditingHour = undefined;
};

const handleActivityInput = (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (activityEditingDay !== undefined && activityEditingHour !== undefined) {
    viewModel?.setActivity(activityEditingDay, activityEditingHour, input.value);
  }
};
</script>

{#if viewModel?.isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Schedule Editor"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        viewModel.close();
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        viewModel.close();
      }
    }}
  >
    <div class="modal-box max-w-5xl w-[95vw] max-h-[90vh] overflow-auto bg-base-100 p-6">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-lg font-bold">{viewModel.npcName} — Weekly Schedule</h3>
          {#if viewModel.isGenerated}
            <span class="badge badge-sm badge-outline ml-2">Auto-generated</span>
          {/if}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => viewModel.close()}>
          ✕
        </button>
      </div>

      <!-- Paint controls -->
      <div class="flex items-center gap-2 mb-4 flex-wrap">
        <span class="text-sm font-semibold mr-1">Paint:</span>
        {#each (['online', 'idle', 'dnd', 'offline'] as AvailabilityStatus[]) as status}
          {@const isActive = viewModel.paintStatus === status}
          {@const statusColor = status === 'online'
            ? 'bg-success'
            : status === 'idle'
              ? 'bg-warning'
              : status === 'dnd'
                ? 'bg-error'
                : 'bg-neutral'}
          <button
            type="button"
            class="btn btn-xs {isActive ? 'btn-primary' : `btn-ghost ${statusColor}`}"
            onclick={() => viewModel.setPaintStatus(status)}
          >
            {viewModel.statusLabels[status] ?? status}
          </button>
        {/each}

        <div class="flex-1"></div>

        <button
          type="button"
          class="btn btn-sm btn-primary"
          onclick={() => viewModel.generateSchedule()}
          disabled={viewModel.isGenerating}
        >
          {#if viewModel.isGenerating}
            <span class="loading loading-spinner loading-xs"></span>
            Generating...
          {:else}
            Generate Schedule
          {/if}
        </button>
      </div>

      {#if viewModel.generationError}
        <div class="alert alert-error text-sm mb-4">{viewModel.generationError}</div>
      {/if}

      <!-- 7×24 Grid -->
      <div class="overflow-auto max-h-[60vh]">
        <div
          class="grid gap-px bg-base-300 border border-base-300 rounded"
          style="grid-template-columns: 60px repeat(7, 1fr); min-width: 800px;"
        >
          <!-- Header row: day labels -->
          <div class="bg-base-200 p-1 text-xs font-semibold text-center">Hour</div>
          {#each viewModel.dayLabels as dayLabel, dayIndex}
            {@const dayRingClass = dayIndex === viewModel.currentDay ? ' ring-2 ring-primary' : ''}
            <div class="bg-base-200 p-1 text-xs font-semibold text-center{dayRingClass}">
              {dayLabel}
            </div>
          {/each}

          <!-- Hour rows -->
          {#each viewModel.hourLabels as hourLabel, hourIndex}
            {@const hourRingClass = hourIndex === viewModel.currentHour ? ' ring-2 ring-primary' : ''}
            <div
              class="bg-base-200 p-0.5 text-xs text-center font-mono flex items-center justify-center{hourRingClass}"
            >
              {hourLabel}
            </div>

            <!-- Day cells for this hour -->
            {#each viewModel.days as day, dayIndex}
              {@const slot = day.hours[hourIndex]}
              {@const isNow = dayIndex === viewModel.currentDay && hourIndex === viewModel.currentHour}
              {@const cellBg = slot?.status === 'online'
                ? 'bg-success/40'
                : slot?.status === 'idle'
                  ? 'bg-warning/40'
                  : slot?.status === 'dnd'
                    ? 'bg-error/40'
                    : 'bg-neutral/30'}
              {@const nowClass = isNow ? ' outline outline-2 outline-primary' : ''}
              <button
                type="button"
                class="p-0.5 cursor-pointer transition-colors relative border-none{cellBg}{nowClass}"
                onpointerdown={() => {
                  isDragging = true;
                  viewModel.paintCell(dayIndex, hourIndex);
                }}
                onpointerenter={() => {
                  if (isDragging) {
                    viewModel.paintCell(dayIndex, hourIndex);
                  }
                }}
                onpointerup={() => {
                  isDragging = false;
                }}
                onclick={() => {
                  activityEditingDay = dayIndex;
                  activityEditingHour = hourIndex;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    activityEditingDay = dayIndex;
                    activityEditingHour = hourIndex;
                  }
                }}
                title="{viewModel.statusLabels[slot?.status ?? 'online']}: {slot?.activity ?? 'Available'}"
                aria-label="{viewModel.dayLabels[dayIndex]} {viewModel.hourLabels[hourIndex]}: {viewModel.statusLabels[slot?.status ?? 'online'] ?? slot?.status}"
              >
                <span class="text-[10px] leading-tight block truncate">
                  {slot?.activity ?? ''}
                </span>
              </button>
            {/each}
          {/each}
        </div>
      </div>

      <!-- Activity editor popup -->
      {#if activityEditingDay !== undefined && activityEditingHour !== undefined}
        {@const day = viewModel.days[activityEditingDay]}
        {@const slot = day?.hours[activityEditingHour]}
        <div
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Activity"
          tabindex="-1"
          onclick={(e) => {
            if (e.target === e.currentTarget) {
              handleActivityClose();
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              handleActivityClose();
            }
          }}
        >
          <div class="bg-base-100 p-4 rounded-lg shadow-lg w-80">
            <p class="text-sm font-semibold mb-2">
              {viewModel.dayLabels[activityEditingDay]} {viewModel.hourLabels[activityEditingHour]}
              <span class="badge badge-xs ml-1"
                >{viewModel.statusLabels[slot?.status ?? 'online']}</span
              >
            </p>
            <label for="activity-input" class="text-xs font-semibold block mb-1">Activity</label>
            <input
              id="activity-input"
              type="text"
              class="input input-bordered input-sm w-full mb-3"
              value={slot?.activity ?? ''}
              oninput={handleActivityInput}
              placeholder="Activity description..."
            >
            <div class="flex justify-end gap-2">
              <button type="button" class="btn btn-sm btn-ghost" onclick={handleActivityClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Footer -->
      <div class="flex justify-end gap-2 mt-4">
        <button type="button" class="btn btn-sm btn-primary" onclick={() => viewModel.close()}>
          Save & Close
        </button>
      </div>
    </div>
    <button
      type="button"
      class="modal-backdrop border-none bg-transparent p-0"
      onclick={() => viewModel.close()}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          viewModel.close();
        }
      }}
      aria-label="Close"
    ></button>
  </div>
{/if}
