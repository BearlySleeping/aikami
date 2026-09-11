// apps/frontend/client/src/lib/views/dev/autonomous_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for autonomous NPC behavior testing.
// Provides mock NPCs, idle simulation, DND toggle, schedule editor
// access, poller control, and a test log.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import {
  AVAILABILITY_STATUS_COLORS,
  AVAILABILITY_STATUS_LABELS,
  DAY_LABELS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AvailabilityStatus, DaySchedule } from '@aikami/types';
import type {
  AutonomousMessageServiceInterface,
  IdleDetectionServiceInterface,
  NpcScheduleServiceInterface,
} from '$services';
import type { ScheduleEditorViewModelInterface } from '../settings/autonomous/schedule_editor_view_model.svelte';

// ── Capability contracts ────────────────────────────────────────────────

/** Idle/DND state and controls the sandbox exercises. */
export type IdleCapabilities = Pick<
  IdleDetectionServiceInterface,
  'idleDurationMs' | 'isDnd' | 'isIdle' | 'resetIdle' | 'setDnd'
>;

/** Autonomous poller state and controls the sandbox exercises. */
export type AutonomousMessageCapabilities = Pick<
  AutonomousMessageServiceInterface,
  'isRunning' | 'isPaused' | 'start' | 'stop' | 'pause' | 'resume'
>;

/** NPC schedule persistence the sandbox seeds and reads. */
export type AutonomousScheduleCapabilities = Pick<
  NpcScheduleServiceInterface,
  'getSchedule' | 'setSchedule'
>;

// ── Types ────────────────────────────────────────────────────────────────

/** Base configuration used to create the autonomous-messaging sandbox ViewModel. */
export type AutonomousSandboxViewModelOptions = BaseViewModelOptions & {
  /** Idle detection capability. */
  idle: IdleCapabilities;
  /** Autonomous message poller capability. */
  autonomousMessages: AutonomousMessageCapabilities;
  /** NPC schedule persistence capability. */
  schedules: AutonomousScheduleCapabilities;
  /** Schedule editor sub-ViewModel. */
  scheduleEditor: ScheduleEditorViewModelInterface;
  /** Platform id generator. Defaults to `crypto.randomUUID`. */
  randomId?: () => string;
};

export type AutonomousSandboxViewModelInterface = BaseViewModelInterface & {
  // --- Reactive state ---
  readonly idleDurationMs: number;
  readonly isDnd: boolean;
  readonly isPollerRunning: boolean;
  readonly isPollerPaused: boolean;
  readonly testLog: string[];
  readonly mockNpcIds: string[];
  readonly currentTimeLabel: string;
  readonly dayLabel: string;
  readonly hourLabel: string;

  // --- Schedule editor (sub-component) ---
  readonly scheduleEditorViewModel: ScheduleEditorViewModelInterface;

  // --- Constants for display ---
  readonly dayLabels: readonly string[];
  readonly statusLabels: Record<string, string>;
  readonly statusColors: Record<string, string>;

  // --- Actions ---
  simulateIdle(options: { seconds: number }): void;
  resetIdle(): void;
  toggleDnd(): void;
  addMockNpc(options: { name: string; personality: string; talkativeness: number }): Promise<void>;
  startPoller(): void;
  stopPoller(): void;
  pausePoller(): void;
  resumePoller(): void;
  openScheduleEditor(options: { npcId: string }): Promise<void>;
  setCurrentTimeOverride(options: { day: number; hour: number }): void;
  clearLog(): void;
};

// ── Mock NPC data ────────────────────────────────────────────────────────

const MOCK_NPCS = [
  {
    id: 'mock-npc-blacksmith',
    name: 'Grimm Forgebeard',
    personality:
      'A grumpy dwarven blacksmith who wakes at dawn and works until sunset. Loves ale and hates small talk.',
    talkativeness: 0.4,
  },
  {
    id: 'mock-npc-rogue',
    name: 'Shadow Elara',
    personality:
      'A nocturnal rogue who prowls the city from midnight to dawn, sleeps through midday, and meets contacts at dusk.',
    talkativeness: 0.3,
  },
  {
    id: 'mock-npc-bard',
    name: 'Melodious Finn',
    personality:
      'An outgoing half-elf bard who performs at taverns every evening. Chatty, dramatic, always ready with a story.',
    talkativeness: 0.9,
  },
];

// ── Implementation ───────────────────────────────────────────────────────

class AutonomousSandboxViewModel
  extends BaseViewModel<AutonomousSandboxViewModelOptions>
  implements AutonomousSandboxViewModelInterface
{
  testLog = $state<string[]>([]);
  readonly scheduleEditorViewModel: ScheduleEditorViewModelInterface;

  private readonly _idle: IdleCapabilities;
  private readonly _autonomousMessages: AutonomousMessageCapabilities;
  private readonly _schedules: AutonomousScheduleCapabilities;
  private readonly _randomId: () => string;

  readonly dayLabels = DAY_LABELS;
  readonly statusLabels = AVAILABILITY_STATUS_LABELS;
  readonly statusColors = AVAILABILITY_STATUS_COLORS;
  currentTimeLabel = $derived(new Date().toLocaleString());
  dayLabel = $derived.by(() => {
    const day = new Date().getDay();
    return `${DAY_LABELS[day]} Day ${day}`;
  });
  hourLabel = $derived.by(() => {
    const hour = new Date().getHours();
    return `${hour}:00 Hour ${hour}`;
  });

  get idleDurationMs(): number {
    return this._idle.idleDurationMs;
  }

  get isDnd(): boolean {
    return this._idle.isDnd;
  }

  get isPollerRunning(): boolean {
    return this._autonomousMessages.isRunning;
  }

  get isPollerPaused(): boolean {
    return this._autonomousMessages.isPaused;
  }

  get mockNpcIds(): string[] {
    return MOCK_NPCS.map((n) => n.id);
  }

  constructor(options: AutonomousSandboxViewModelOptions) {
    super(options);
    this._idle = options.idle;
    this._autonomousMessages = options.autonomousMessages;
    this._schedules = options.schedules;
    this._randomId = options.randomId ?? (() => crypto.randomUUID());
    this.scheduleEditorViewModel = options.scheduleEditor;
  }

  override async initialize(): Promise<void> {
    this._seedMockSchedules();
    this._log('Sandbox initialized — idle detection active');
    await super.initialize();
  }

  // ── Actions ─────────────────────────────────────────────────────────

  simulateIdle(options: { seconds: number }): void {
    this._idle.resetIdle();
    this._log(
      `Simulated idle wanted ${options.seconds}s — reset. Current: ${this._idle.idleDurationMs}ms`,
    );

    // HACK: advance time via the tracking interval
    // The idle duration updates every 1s via setInterval
    setTimeout(() => {
      this._log(`After 1s tick: idleDurationMs = ${this._idle.idleDurationMs}ms`);
      this._log(
        `isIdle(300000) = ${this._idle.isIdle(300_000)} | isIdle(0) = ${this._idle.isIdle(0)}`,
      );
    }, 1100);
  }

  resetIdle(): void {
    this._idle.resetIdle();
    this._log('Idle reset to 0');
  }

  toggleDnd(): void {
    const newState = !this._idle.isDnd;
    this._idle.setDnd(newState);
    this._log(`DND ${newState ? 'ON' : 'OFF'}`);
  }

  async addMockNpc(options: {
    name: string;
    personality: string;
    talkativeness: number;
  }): Promise<void> {
    const mockId = `mock-${this._randomId().slice(0, 8)}`;

    // Create a default 7×24 schedule for this mock NPC
    const makeDay = (day: number): DaySchedule => ({
      day,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        status: 'online' as AvailabilityStatus,
        activity: 'Available',
      })),
    });

    await this._schedules.setSchedule(mockId, {
      npcId: mockId,
      days: Array.from({ length: 7 }, (_, day) => makeDay(day)),
      autonomousEnabled: true,
      talkativeness: options.talkativeness,
      cooldownMinutes: 15,
      generated: false,
      updatedAt: new Date().toISOString(),
    });

    this._log(
      `Added mock NPC: ${options.name} (${mockId}), talkativeness: ${options.talkativeness}`,
    );
  }

  startPoller(): void {
    this._autonomousMessages.start();
    this._log('Poller started');
  }

  stopPoller(): void {
    this._autonomousMessages.stop();
    this._log('Poller stopped');
  }

  pausePoller(): void {
    this._autonomousMessages.pause();
    this._log('Poller paused');
  }

  resumePoller(): void {
    this._autonomousMessages.resume();
    this._log('Poller resumed');
  }

  async openScheduleEditor(options: { npcId: string }): Promise<void> {
    const npc = MOCK_NPCS.find((n) => n.id === options.npcId);
    if (npc) {
      // Ensure the mock schedule exists
      const schedule = await this._schedules.getSchedule(options.npcId);
      if (schedule.generated) {
        // Already exists — just open
      }
      await this.scheduleEditorViewModel.open({
        npcId: options.npcId,
        npcName: npc.name,
      });
      this._log(`Opened schedule editor for ${npc.name}`);
    }
  }

  setCurrentTimeOverride(options: { day: number; hour: number }): void {
    this._log(
      `Time override set to day ${options.day} (${DAY_LABELS[options.day]}), hour ${options.hour}`,
    );
  }

  clearLog(): void {
    this.testLog = [];
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _seedMockSchedules(): void {
    // Seed the schedule service cache with mock NPC schedules
    for (const npc of MOCK_NPCS) {
      const makeDay = (day: number): DaySchedule => {
        let defaultStatus: AvailabilityStatus = 'online';

        // Apply personality-specific patterns
        if (npc.id === 'mock-npc-blacksmith') {
          // Blacksmith: online 6-20, offline 21-5
          return {
            day,
            hours: Array.from({ length: 24 }, (_, hour) => {
              const isAsleep = hour >= 21 || hour < 6;
              return {
                hour,
                status: isAsleep ? ('offline' as const) : ('online' as const),
                activity: isAsleep ? 'Sleeping' : 'Working the forge',
              };
            }),
          };
        }

        if (npc.id === 'mock-npc-rogue') {
          // Rogue: offline 6-14 (sleeping), idle 14-18, online 18-6
          return {
            day,
            hours: Array.from({ length: 24 }, (_, hour) => {
              if (hour >= 6 && hour < 14) {
                return { hour, status: 'offline' as const, activity: 'Sleeping' };
              }
              if (hour >= 14 && hour < 18) {
                return { hour, status: 'idle' as const, activity: 'Preparing' };
              }
              return { hour, status: 'online' as const, activity: 'On the prowl' };
            }),
          };
        }

        // Bard: default online
        defaultStatus = 'online';
        return {
          day,
          hours: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            status: defaultStatus,
            activity: hour >= 18 && hour < 23 ? 'Performing at the tavern' : 'Available',
          })),
        };
      };

      const schedule = {
        npcId: npc.id,
        days: Array.from({ length: 7 }, (_, day) => makeDay(day)),
        autonomousEnabled: true,
        talkativeness: npc.talkativeness,
        cooldownMinutes: 15,
        generated: false,
        updatedAt: new Date().toISOString(),
      };

      // Seed silently — don't await, it will be picked up from cache
      this._schedules.setSchedule(npc.id, schedule).catch(() => {
        // Firestore may not be available in sandbox — that's OK
      });
    }

    this._log(`Seeded ${MOCK_NPCS.length} mock NPC schedules`);
  }

  private _log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.testLog = [...this.testLog, `[${timestamp}] ${message}`];
  }
}

export const createAutonomousSandboxViewModel = (
  options: AutonomousSandboxViewModelOptions,
): AutonomousSandboxViewModelInterface => AutonomousSandboxViewModel.create(options);
