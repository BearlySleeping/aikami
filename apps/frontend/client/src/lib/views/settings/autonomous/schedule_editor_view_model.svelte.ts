// apps/frontend/client/src/lib/views/settings/autonomous/schedule_editor_view_model.svelte.ts
//
// ViewModel for the NPC schedule editor — 7×24 grid with drag-paint,
// activity editing, and schedule generation.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import {
  AVAILABILITY_STATUS_COLORS,
  AVAILABILITY_STATUS_LABELS,
  DAY_LABELS,
  HOUR_LABELS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AvailabilityStatus, DaySchedule } from '@aikami/types';
import { textGenerationService } from '$lib/services/ai/text_generation_service.svelte.ts';
import { npcScheduleService } from '$services';

// ── Types ────────────────────────────────────────────────────────────────

export type ScheduleEditorViewModelInterface = BaseViewModelInterface & {
  /** Whether the editor modal is open. */
  readonly isOpen: boolean;
  /** The NPC whose schedule is being edited. */
  readonly npcId: string | undefined;
  /** The NPC's name for display. */
  readonly npcName: string;
  /** Current 7×24 day schedules (reactive). */
  readonly days: DaySchedule[];
  /** The current day of the week (0-6). */
  readonly currentDay: number;
  /** The current hour (0-23). */
  readonly currentHour: number;
  /** Whether a schedule generation is in progress. */
  readonly isGenerating: boolean;
  /** Whether the schedule was auto-generated. */
  readonly isGenerated: boolean;
  /** Error message from generation, or undefined. */
  readonly generationError: string | undefined;
  /** Day labels for the grid columns. */
  readonly dayLabels: readonly string[];
  /** Hour labels for the grid rows. */
  readonly hourLabels: readonly string[];
  /** Status color map. */
  readonly statusColors: Record<string, string>;
  /** Status labels map. */
  readonly statusLabels: Record<string, string>;
  /** Currently selected paint status for drag-paint. */
  readonly paintStatus: AvailabilityStatus;

  /** Opens the editor for a specific NPC. */
  open(options: { npcId: string; npcName: string }): Promise<void>;
  /** Closes the editor and saves if dirty. */
  close(): Promise<void>;
  /** Paints a cell at (day, hour) with the current paintStatus. */
  paintCell(day: number, hour: number): void;
  /** Sets the paint status for drag-paint mode. */
  setPaintStatus(status: AvailabilityStatus): void;
  /** Updates the activity text for a specific slot. */
  setActivity(day: number, hour: number, activity: string): void;
  /** Generates a schedule via the Schedule Planner agent. */
  generateSchedule(): Promise<void>;
};

// ── Options ──────────────────────────────────────────────────────────────

export type ScheduleEditorViewModelOptions = BaseViewModelOptions;

// ── Implementation ───────────────────────────────────────────────────────

class ScheduleEditorViewModel
  extends BaseViewModel<ScheduleEditorViewModelOptions>
  implements ScheduleEditorViewModelInterface
{
  isOpen = $state(false);
  npcId: string | undefined = $state(undefined);
  npcName = $state('');
  days = $state<DaySchedule[]>([]);
  isGenerating = $state(false);
  isGenerated = $state(false);
  generationError: string | undefined = $state(undefined);
  paintStatus: AvailabilityStatus = $state('online');

  readonly dayLabels = DAY_LABELS;
  readonly hourLabels = HOUR_LABELS;
  readonly statusColors = AVAILABILITY_STATUS_COLORS;
  readonly statusLabels = AVAILABILITY_STATUS_LABELS;

  get currentDay(): number {
    return new Date().getDay();
  }

  get currentHour(): number {
    return new Date().getHours();
  }

  // ── Public API ──────────────────────────────────────────────────────

  async open(options: { npcId: string; npcName: string }): Promise<void> {
    this.npcId = options.npcId;
    this.npcName = options.npcName;
    this.isGenerating = false;
    this.generationError = undefined;

    const schedule = await npcScheduleService.getSchedule(options.npcId);
    this.days = schedule.days;
    this.isGenerated = schedule.generated;
    this.isOpen = true;
  }

  async close(): Promise<void> {
    if (!this.npcId) {
      this.isOpen = false;
      return;
    }

    // Save if modified
    await this._saveSchedule();
    this.isOpen = false;
  }

  paintCell(day: number, hour: number): void {
    const daySchedule = this.days[day];
    if (!daySchedule) {
      return;
    }
    const slot = daySchedule.hours[hour];
    if (!slot) {
      return;
    }
    slot.status = this.paintStatus;
    // Trigger reactivity
    this.days = [...this.days];
  }

  setPaintStatus(status: AvailabilityStatus): void {
    this.paintStatus = status;
  }

  setActivity(day: number, hour: number, activity: string): void {
    const daySchedule = this.days[day];
    if (!daySchedule) {
      return;
    }
    const slot = daySchedule.hours[hour];
    if (!slot) {
      return;
    }
    slot.activity = activity || undefined;
    this.days = [...this.days];
  }

  async generateSchedule(): Promise<void> {
    if (!this.npcId) {
      return;
    }

    this.isGenerating = true;
    this.generationError = undefined;

    try {
      // Use text generation service to call the Schedule Planner agent

      const result = (await textGenerationService.extractStructure({
        schema: {
          type: 'object',
          properties: {
            dailyPattern: { type: 'string', minLength: 1 },
            schedule: {
              type: 'object',
              properties: {
                days: {
                  type: 'array',
                  minItems: 7,
                  maxItems: 7,
                  items: {
                    type: 'object',
                    properties: {
                      day: { type: 'integer', minimum: 0, maximum: 6 },
                      hours: {
                        type: 'array',
                        minItems: 24,
                        maxItems: 24,
                        items: {
                          type: 'object',
                          properties: {
                            hour: { type: 'integer', minimum: 0, maximum: 23 },
                            status: {
                              type: 'string',
                              enum: ['online', 'idle', 'dnd', 'offline'],
                            },
                            activity: { type: 'string' },
                          },
                          required: ['hour', 'status'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['day', 'hours'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['days'],
              additionalProperties: false,
            },
            suggestedTalkativeness: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['dailyPattern', 'schedule', 'suggestedTalkativeness'],
          additionalProperties: false,
        },
        schemaName: 'SchedulePlanner',
        prompt: `Generate a realistic 7-day weekly schedule for this NPC: "${this.npcName}". Populate all 168 cells (7 days × 24 hours) with statuses and activities.`,
        systemPrompt: 'Generate fantasy RPG NPC weekly schedules. JSON only. No markdown.',
      })) as {
        dailyPattern: string;
        schedule: { days: DaySchedule[] };
        suggestedTalkativeness: number;
      };

      // Validate and apply the generated schedule
      if (result.schedule?.days && result.schedule.days.length === 7) {
        this.days = result.schedule.days;
        this.isGenerated = true;

        // Immediately save the generated schedule
        await this._saveSchedule();
      } else {
        this.generationError = 'Generated schedule was invalid. Please try again.';
      }
    } catch (error) {
      this.debug('generateSchedule:failed', error);
      this.generationError = 'Schedule generation failed — try again or create manually.';
    } finally {
      this.isGenerating = false;
    }
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async _saveSchedule(): Promise<void> {
    if (!this.npcId) {
      return;
    }
    const schedule = await npcScheduleService.getSchedule(this.npcId);
    schedule.days = this.days;
    schedule.generated = this.isGenerated;
    await npcScheduleService.setSchedule(this.npcId, schedule);
  }
}

export const getScheduleEditorViewModel = (
  options: ScheduleEditorViewModelOptions,
): ScheduleEditorViewModelInterface => ScheduleEditorViewModel.create(options);
