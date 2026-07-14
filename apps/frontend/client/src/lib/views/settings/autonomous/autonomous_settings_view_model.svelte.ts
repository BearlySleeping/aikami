// apps/frontend/client/src/lib/views/settings/autonomous/autonomous_settings_view_model.svelte.ts
//
// ViewModel for the Autonomous NPCs settings section.
// Global toggles, idle threshold, poller interval, cooldown sliders.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import {
  DEFAULT_COOLDOWN_MINUTES,
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_POLLER_INTERVAL_MS,
  MAX_COOLDOWN_MINUTES,
  MAX_IDLE_THRESHOLD_MS,
  MAX_POLLER_INTERVAL_MS,
  MIN_COOLDOWN_MINUTES,
  MIN_IDLE_THRESHOLD_MS,
  MIN_POLLER_INTERVAL_MS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ScheduleEditorViewModelInterface } from './schedule_editor_view_model.svelte';
import { getScheduleEditorViewModel } from './schedule_editor_view_model.svelte';

// ── Types ────────────────────────────────────────────────────────────────

export type AutonomousSettingsViewModelInterface = BaseViewModelInterface & {
  /** Global pause toggle for all autonomous messages. */
  readonly isGloballyPaused: boolean;
  /** Idle threshold in minutes (UI-friendly). */
  readonly idleThresholdMinutes: number;
  /** Poller interval in seconds (UI-friendly). */
  readonly pollerIntervalSeconds: number;
  /** Default cooldown in minutes. */
  readonly defaultCooldownMinutes: number;
  /** Min/max values for sliders. */
  readonly idleThresholdMin: number;
  readonly idleThresholdMax: number;
  readonly pollerIntervalMin: number;
  readonly pollerIntervalMax: number;
  readonly cooldownMin: number;
  readonly cooldownMax: number;
  /** Schedule editor ViewModel (sub-component). */
  readonly scheduleEditorViewModel: ScheduleEditorViewModelInterface;

  /** Toggles the global pause state. */
  setGloballyPaused(paused: boolean): void;
  /** Sets idle threshold in minutes. */
  setIdleThresholdMinutes(minutes: number): void;
  /** Sets poller interval in seconds. */
  setPollerIntervalSeconds(seconds: number): void;
  /** Sets default cooldown in minutes. */
  setDefaultCooldownMinutes(minutes: number): void;
};

// ── Options ──────────────────────────────────────────────────────────────

export type AutonomousSettingsViewModelOptions = BaseViewModelOptions;

// ── LocalStorage keys ────────────────────────────────────────────────────

const LS_PREFIX = 'aikami_autonomous_';

// ── Implementation ───────────────────────────────────────────────────────

class AutonomousSettingsViewModel
  extends BaseViewModel<AutonomousSettingsViewModelOptions>
  implements AutonomousSettingsViewModelInterface
{
  isGloballyPaused = $state(false);
  idleThresholdMinutes = $state(DEFAULT_IDLE_THRESHOLD_MS / 60_000);
  pollerIntervalSeconds = $state(DEFAULT_POLLER_INTERVAL_MS / 1000);
  defaultCooldownMinutes = $state(DEFAULT_COOLDOWN_MINUTES);
  readonly scheduleEditorViewModel: ScheduleEditorViewModelInterface;

  readonly idleThresholdMin = MIN_IDLE_THRESHOLD_MS / 60_000;
  readonly idleThresholdMax = MAX_IDLE_THRESHOLD_MS / 60_000;
  readonly pollerIntervalMin = MIN_POLLER_INTERVAL_MS / 1000;
  readonly pollerIntervalMax = MAX_POLLER_INTERVAL_MS / 1000;
  readonly cooldownMin = MIN_COOLDOWN_MINUTES;
  readonly cooldownMax = MAX_COOLDOWN_MINUTES;

  constructor(options: AutonomousSettingsViewModelOptions) {
    super(options);
    this.scheduleEditorViewModel = getScheduleEditorViewModel({
      className: 'ScheduleEditorViewModel',
    });
  }

  override async initialize(): Promise<void> {
    this._loadFromLocalStorage();
    await super.initialize();
  }

  // ── Public API ──────────────────────────────────────────────────────

  setGloballyPaused(paused: boolean): void {
    this.isGloballyPaused = paused;
    this._saveToLocalStorage();
  }

  setIdleThresholdMinutes(minutes: number): void {
    this.idleThresholdMinutes = minutes;
    this._saveToLocalStorage();
  }

  setPollerIntervalSeconds(seconds: number): void {
    this.pollerIntervalSeconds = seconds;
    this._saveToLocalStorage();
  }

  setDefaultCooldownMinutes(minutes: number): void {
    this.defaultCooldownMinutes = minutes;
    this._saveToLocalStorage();
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _loadFromLocalStorage(): void {
    try {
      const paused = localStorage.getItem(`${LS_PREFIX}globally_paused`);
      if (paused !== null) {
        this.isGloballyPaused = paused === 'true';
      }
      const idle = localStorage.getItem(`${LS_PREFIX}idle_threshold`);
      if (idle !== null) {
        this.idleThresholdMinutes = Number(idle);
      }
      const interval = localStorage.getItem(`${LS_PREFIX}poller_interval`);
      if (interval !== null) {
        this.pollerIntervalSeconds = Number(interval);
      }
      const cooldown = localStorage.getItem(`${LS_PREFIX}cooldown`);
      if (cooldown !== null) {
        this.defaultCooldownMinutes = Number(cooldown);
      }
    } catch {
      // localStorage not available — use defaults
    }
  }

  private _saveToLocalStorage(): void {
    try {
      localStorage.setItem(`${LS_PREFIX}globally_paused`, String(this.isGloballyPaused));
      localStorage.setItem(`${LS_PREFIX}idle_threshold`, String(this.idleThresholdMinutes));
      localStorage.setItem(`${LS_PREFIX}poller_interval`, String(this.pollerIntervalSeconds));
      localStorage.setItem(`${LS_PREFIX}cooldown`, String(this.defaultCooldownMinutes));
    } catch {
      // localStorage not available — silently ignore
    }
  }
}

export const getAutonomousSettingsViewModel = (
  options: AutonomousSettingsViewModelOptions,
): AutonomousSettingsViewModelInterface => AutonomousSettingsViewModel.create(options);
