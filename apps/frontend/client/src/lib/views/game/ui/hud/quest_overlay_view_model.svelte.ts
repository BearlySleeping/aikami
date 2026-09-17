// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_view_model.svelte.ts
//
// QuestOverlayViewModel — thin ViewModel over the quest overlay/state and
// campaign capabilities powering the optional active-quest mini overlay
// (mirrors the music player overlay pattern).
//
// Shows the current active quest, its description, and per-objective progress,
// so the player always knows what they are working toward.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/quest_overlay_fixtures.ts).
// Production wiring lives in ./quest_overlay_composition.ts.

import type { QuestData, QuestObjectiveData } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** Persisted overlay visibility. */
export type QuestOverlayVisibilityCapabilities = {
  readonly visible: boolean;
  setVisible(visible: boolean): void;
};

/** The quest list the overlay derives the active quest from (read reactively). */
export type QuestOverlayQuestStateCapabilities = {
  readonly quests: QuestData[];
  getEligibleEndings(questId: string): Array<{ id: string; title: string; unlocked: boolean }>;
  chooseEnding(options: { questId: string; endingId: string }): boolean;
};

/** The active campaign fields the overlay reads. */
export type QuestOverlayCampaignCapabilities = {
  readonly activeCampaign: { readonly sampledTruthId?: string } | undefined;
};

// ── Types ───────────────────────────────────────────────────────────────

export type QuestOverlayObjective = QuestObjectiveData;

/** Player-facing ending option derived from live quest state. */
export type QuestOverlayEndingOption = {
  readonly id: string;
  readonly title: string;
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly statusLabel: string;
  readonly buttonClass: string;
};

export type QuestOverlayViewModelInterface = BaseViewModelInterface & {
  /**
   * Whether the overlay is visible. A quest that is resolution-ready forces it
   * on: the final ending choice is a blocking player decision, not an optional
   * readout, so a hidden HUD must not be able to strand the quest.
   */
  readonly visible: boolean;

  /** Whether any quest is currently active. */
  readonly hasActiveQuest: boolean;

  /**
   * The quest the overlay presents: a resolution-ready quest when one exists
   * (its ending choice is the blocking decision), otherwise the first active.
   */
  readonly activeQuest: QuestData | undefined;

  /** Title of the current active quest, or a placeholder. */
  readonly questTitle: string;

  /** Description of the current active quest. */
  readonly questDescription: string;

  /** Objective list of the current active quest. */
  readonly objectives: readonly QuestOverlayObjective[];

  /** Index of the current incomplete objective (or -1 when all done). */
  readonly currentObjectiveIndex: number;

  /** Percentage (0-100) of the current objective's progress. */
  readonly currentObjectivePercent: number;

  /** Whether the active quest authors ending choices. */
  readonly hasEndingOptions: boolean;

  /**
   * Whether the active quest has finished its required objectives and is
   * waiting for the player's final choice. Ending options are presented ONLY
   * in this state — never while the quest is still being played.
   */
  readonly awaitingEndingChoice: boolean;

  /** Live ending choices, including locked and persisted selected state. */
  readonly endingOptions: readonly QuestOverlayEndingOption[];

  /** Commits an unlocked choice, which resolves the quest. */
  selectEnding(endingId: string): void;

  /** Hides the overlay (persisted). Ignored while a choice is pending. */
  hide(): void;

  /** The campaign's sampled hidden truth id (C-495), or undefined. */
  readonly sampledTruthId: string | undefined;
};

export type QuestOverlayViewModelOptions = BaseViewModelOptions & {
  /** Persisted overlay visibility. */
  overlay: QuestOverlayVisibilityCapabilities;
  /** Quest list the active quest is derived from. */
  questState: QuestOverlayQuestStateCapabilities;
  /** Active campaign the overlay reads. */
  campaign: QuestOverlayCampaignCapabilities;
};

// ── Implementation ──────────────────────────────────────────────────────

class QuestOverlayViewModel
  extends BaseViewModel<QuestOverlayViewModelOptions>
  implements QuestOverlayViewModelInterface
{
  private readonly _overlay: QuestOverlayVisibilityCapabilities;
  private readonly _questState: QuestOverlayQuestStateCapabilities;
  private readonly _campaign: QuestOverlayCampaignCapabilities;

  constructor(options: QuestOverlayViewModelOptions) {
    super(options);
    this._overlay = options.overlay;
    this._questState = options.questState;
    this._campaign = options.campaign;
  }

  get visible(): boolean {
    // A pending final decision overrides the optional HUD toggle.
    return this._overlay.visible || this.awaitingEndingChoice;
  }

  /**
   * A resolution-ready quest takes precedence over accept order: its ending
   * choice is the decision the player is being asked to make, and presenting a
   * different quest's objectives would hide it.
   */
  get activeQuest(): QuestData | undefined {
    const active = this._questState.quests.filter((quest) => quest.status === 'active');
    return active.find((quest) => quest.awaitingEndingChoice === true) ?? active[0];
  }

  get awaitingEndingChoice(): boolean {
    return this.activeQuest?.awaitingEndingChoice === true;
  }

  get hasActiveQuest(): boolean {
    return this.activeQuest !== undefined;
  }

  get questTitle(): string {
    return this.activeQuest?.title ?? 'No active quest';
  }

  get questDescription(): string {
    return this.activeQuest?.description ?? '';
  }

  get objectives(): readonly QuestOverlayObjective[] {
    return this.activeQuest?.objectives ?? [];
  }

  get currentObjectiveIndex(): number {
    const quest = this.activeQuest;
    if (!quest) {
      return -1;
    }
    const idx = quest.objectives.findIndex(
      (o) => o.current < o.max && o.status !== 'completed' && o.status !== 'failed',
    );
    return idx;
  }

  get currentObjectivePercent(): number {
    const quest = this.activeQuest;
    if (!quest) {
      return 0;
    }
    const idx = this.currentObjectiveIndex;
    if (idx < 0) {
      return 100;
    }
    const obj = quest.objectives[idx];
    if (!obj) {
      return 0;
    }
    return Math.round((obj.current / obj.max) * 100);
  }

  get endingOptions(): readonly QuestOverlayEndingOption[] {
    const quest = this.activeQuest;
    if (!quest) {
      return [];
    }
    return this._questState.getEligibleEndings(quest.id).map((ending) => {
      const selected = quest.chosenEndingId === ending.id;
      let statusLabel = 'Locked';
      if (selected) {
        statusLabel = 'Selected';
      } else if (ending.unlocked) {
        statusLabel = 'Choose';
      }
      return {
        id: ending.id,
        title: ending.title,
        disabled: !ending.unlocked,
        selected,
        statusLabel,
        buttonClass: selected
          ? 'btn btn-primary btn-xs w-full justify-between'
          : 'btn btn-ghost btn-xs w-full justify-between',
      };
    });
  }

  get hasEndingOptions(): boolean {
    // Strictly gated to the resolution point: a quest that is still being
    // played must never expose its conclusion as an actionable control.
    return this.awaitingEndingChoice && this.endingOptions.length > 0;
  }

  selectEnding(endingId: string): void {
    const quest = this.activeQuest;
    if (!quest || !this.awaitingEndingChoice) {
      return;
    }
    this._questState.chooseEnding({ questId: quest.id, endingId });
  }

  hide(): void {
    // The pending decision cannot be dismissed: the quest would be stranded
    // with no way to choose its conclusion.
    if (this.awaitingEndingChoice) {
      return;
    }
    this._overlay.setVisible(false);
  }

  /** @inheritdoc */
  get sampledTruthId(): string | undefined {
    return this._campaign.activeCampaign?.sampledTruthId;
  }
}

/**
 * Builds a quest-overlay ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getQuestOverlayViewModel` in ./quest_overlay_composition.ts.
 */
export const createQuestOverlayViewModel = (
  options: QuestOverlayViewModelOptions,
): QuestOverlayViewModelInterface => QuestOverlayViewModel.create(options);
