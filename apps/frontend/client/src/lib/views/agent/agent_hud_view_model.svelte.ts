// apps/frontend/client/src/lib/views/agent/agent_hud_view_model.svelte.ts
//
// ViewModel for the Agent HUD overlay UI. Manages drawer visibility,
// thought bubble display, and agent status badge rendering.
//
// Contract: C-236 Agent Pipeline System

import { PHASE_LABELS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AgentPhase, AgentRunResult } from '$types';

// ── Types ────────────────────────────────────────────────────────────────

export type AgentHudViewModelOptions = BaseViewModelOptions;

export type AgentHudViewModelInterface = BaseViewModelInterface & {
  /** Whether the drawer is visible. */
  showDrawer: boolean;
  /** Whether the pipeline is currently running. */
  isRunning: boolean;
  /** Current phase label for display. */
  currentPhaseLabel: string;
  /** Current agent name for display. */
  currentAgentName: string;
  /** All results from the current run. */
  results: ReadonlyArray<AgentRunResult>;
  /** Count of successful results. */
  readonly successCount: number;
  /** Count of failed results. */
  readonly failureCount: number;
  /** Total duration of all agent runs in milliseconds. */
  readonly totalDurationMs: number;

  /** Toggles the drawer open/closed. */
  toggleDrawer(): void;

  /**
   * Updates the HUD state from an external source (the pipeline ViewModel).
   */
  updateState(options: {
    isRunning: boolean;
    phase?: AgentPhase | null;
    agentName?: string | null;
    results?: AgentRunResult[];
  }): void;
};

// ── Implementation ───────────────────────────────────────────────────────

export class AgentHudViewModel
  extends BaseViewModel<AgentHudViewModelOptions>
  implements AgentHudViewModelInterface
{
  showDrawer = $state(false);
  isRunning = $state(false);
  currentPhaseLabel = $state('');
  currentAgentName = $state('');
  results = $state<AgentRunResult[]>([]);

  // ── Getters ──────────────────────────────────────────────────────

  get successCount(): number {
    return this.results.filter((r) => r.success).length;
  }

  get failureCount(): number {
    return this.results.filter((r) => !r.success).length;
  }

  get totalDurationMs(): number {
    return this.results.reduce((sum, r) => sum + r.durationMs, 0);
  }

  // ── Public methods ───────────────────────────────────────────────

  /** @inheritdoc */
  toggleDrawer(): void {
    this.showDrawer = !this.showDrawer;
  }

  /**
   * Updates the HUD state from an external source (the pipeline ViewModel).
   *
   * @param options - State update.
   */
  updateState({
    isRunning,
    phase,
    agentName,
    results: newResults,
  }: {
    isRunning: boolean;
    phase?: AgentPhase | null;
    agentName?: string | null;
    results?: AgentRunResult[];
  }): void {
    this.isRunning = isRunning;
    this.currentPhaseLabel = phase ? PHASE_LABELS[phase] : '';
    this.currentAgentName = agentName ?? '';
    if (newResults) {
      this.results = newResults;
    }
  }
}

export const getAgentHudViewModel = (
  options: AgentHudViewModelOptions,
): AgentHudViewModelInterface => AgentHudViewModel.create(options);
