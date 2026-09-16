// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_interface.ts
//
// C-543 — the game UI overlay-router ViewModel's PUBLIC CONTRACT.
//
// Split out from `game_ui_view_model.svelte.ts` (as the capability contracts
// already are in `game_ui_view_model_types.ts`) so the router implementation
// stays within its reviewed size budget. This is a cohesive responsibility of
// its own: exactly what the overlay router exposes to the game UI view and the
// management host.
//
// Type-only imports only — no runtime module is pulled in by depending on this
// contract.

import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { AutoSaveStatus, GameOverlayType, MotionPreference, OverlayStackEntry } from '$types';
import type { CombatViewModelInterface } from '$views/combat/combat_view_model.svelte';
import type { DialogueOverlayViewModelInterface } from '$views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte';
import type { EndSessionViewModelInterface } from '$views/game/ui/overlays/end_session/end_session_view_model.svelte';
import type { GameOverViewModelInterface } from '$views/game/ui/overlays/game_over/game_over_view_model.svelte';
import type { PauseMenuViewModelInterface } from '$views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';
import type { SettingsOverlayViewModelInterface } from '$views/game/ui/overlays/settings/settings_overlay_view_model.svelte';
import type { TalkToPartyViewModelInterface } from '$views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte';
import type { QuestTrackerViewModelInterface } from '$views/game/ui/quest_tracker_view_model.svelte';
import type { VendorViewModelInterface } from '$views/vendor/vendor_view_model.svelte';
import type { GameHudViewInterface } from './game_hud_surface.svelte.ts';
import type { HudPartyStatus, HudPlayerStatus } from './game_ui_status_projections.ts';
import type { HudLayoutEditorViewModelInterface } from './hud/hud_layout_editor_view_model.svelte';
import type { ManagementLocation, ManagementSectionId } from './management_sections.ts';
import type {
  GameManagementSessionInterface,
  ManagementReturnContext,
} from './management_session.svelte.ts';

export type GameUIViewModelContract = BaseViewModelInterface & {
  readonly activeOverlay: GameOverlayType;
  readonly overlayStack: readonly OverlayStackEntry[];
  readonly isTransitioning: boolean;
  readonly isCombat: boolean;
  readonly autoSaveStatus: AutoSaveStatus;
  readonly gameHour: number;
  readonly gameMinute: number;
  readonly windVelocity: number;
  readonly rainIntensity: number;

  /** Whether the chat is locked (read-only) — session has ended. */
  readonly chatLocked: boolean;

  // ── Player HP (C-332 AC-1) ──

  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly hpPercent: number;
  /** C-543 — the projected status surface (percent + tone + labels). */
  readonly playerStatus: HudPlayerStatus;

  /** C-543 PART F — the projected party status surface. */
  readonly partyStatus: HudPartyStatus;

  // ── Quest Tracker (C-332 AC-1) ──
  readonly questTrackerViewModel: QuestTrackerViewModelInterface;

  // ── HUD Visibility (C-332 AC-1, AC-5) ──

  /** Whether to show the clock HUD (hidden during pause menu, game over, end session). */
  readonly showClockHud: boolean;
  /** Whether to show the HP bar (explore only, hidden during combat, pause, game over). */
  readonly showHpBar: boolean;
  /** Whether to show the quest tracker (explore only). */
  readonly showQuestTracker: boolean;
  /** Whether the quest overlay is visible (persisted setting). */
  readonly questOverlayVisible: boolean;
  /** Whether to show the autosave indicator (hidden during pause menu, game over, end session). */
  readonly showAutosaveIndicator: boolean;
  /** Whether to show the hotbar (C-337) — visible during exploration, hidden during overlays/combat. */
  readonly showHotbar: boolean;
  /** Whether the exploration management navigation is visible. */
  readonly showManagementNav: boolean;

  // ── HUD layout (C-528) — the resolved surface the HUD markup reads. ──
  readonly hud: GameHudViewInterface;
  /** C-528: the paused HUD layout editor ViewModel, when open. */
  readonly hudEditorViewModel: HudLayoutEditorViewModelInterface | undefined;

  // ── Management navigation (HUD → overlay router) ──

  /**
   * Concatenated location of the active management overlay, or undefined when
   * the current overlay is not a management destination. Derived from the
   * overlay stack via the C-527 legacy mapping — there is no second router.
   */
  readonly managementLocation: ManagementLocation | undefined;
  /** The last location opened through the host, used by the Menu entry. */
  readonly menuLocation: ManagementLocation;
  /** Whether the current overlay is one of the management destinations. */
  readonly isManagementOpen: boolean;
  /**
   * Captured origin of the current management session, or undefined when no
   * session is open. Used by `closeManagement` to return the player.
   */
  readonly returnContext: ManagementReturnContext | undefined;

  /** Opens a canonical section at its default subview. */
  openManagementSection(section: ManagementSectionId): void;
  /**
   * Opens (or replaces a sibling with) a normalized management location.
   * Unknown sections are ignored; an unknown subview falls back to the
   * section default rather than throwing.
   */
  openManagementLocation(location: ManagementLocation): void;
  /** Opens the management host through the HUD Menu entry. */
  openManagementMenu(): void;
  /** Closes the active management section through its owning overlay close. */
  closeManagement(): void;

  // ── Overlay ViewModels (created on demand by initialize) ──

  readonly pauseMenuViewModel: PauseMenuViewModelInterface | undefined;
  readonly dialogueViewModel: DialogueOverlayViewModelInterface | undefined;
  readonly combatViewModel: CombatViewModelInterface | undefined;
  readonly vendorViewModel: VendorViewModelInterface | undefined;
  readonly endSessionViewModel: EndSessionViewModelInterface | undefined;
  readonly gameOverViewModel: GameOverViewModelInterface | undefined;
  readonly settingsOverlayViewModel: SettingsOverlayViewModelInterface | undefined;

  /**
   * C-527: the management host session — the section ViewModels, the section
   * registry navigation and the captured return context. See
   * `management_session.svelte.ts`.
   */
  readonly management: GameManagementSessionInterface;

  // ── Talk to Party (C-340) ──
  readonly talkToPartyViewModel: TalkToPartyViewModelInterface | undefined;

  // ── Interaction HUD (C-327) ──

  /** Current interaction prompt label (e.g. "E — Talk to Elder Thalia"). */
  readonly interactionPromptLabel: string;
  /** Whether the interaction prompt is visible. */
  readonly interactionPromptVisible: boolean;
  /** Current onboarding hint text, or undefined if none. */
  readonly onboardingHintText: string | undefined;
  /** Whether the onboarding hint toast is visible. */
  readonly onboardingHintVisible: boolean;
  /** Index of the current onboarding step (0-based), or -1 if none. */
  readonly onboardingStepIndex: number;
  /** Total number of onboarding steps in the loaded arc. */
  readonly onboardingTotalSteps: number;
  /** Whether the user prefers reduced motion (AC-5). */
  readonly reducedMotion: boolean;
  /** C-527 AC-6: the `data-motion` value the effective policy publishes. */
  readonly motionAttribute: 'reduced' | 'full';
  /** C-527 AC-6: the player's explicit motion selection (`auto` follows the OS). */
  readonly motionPreference: MotionPreference;
  /**
   * C-527 AC-6: sets the explicit motion selection. An explicit value wins
   * under either OS preference; `auto` defers to the OS.
   */
  setMotionPreference(preference: MotionPreference): void;

  handleKeyDown(event: KeyboardEvent): void;
  /** Tab-focus-trap for the Quest Log dialog only — must NOT also dispatch to
   * this._overlays.handleKeyDown(), which the window-level listener
   * already calls for the same keydown as it bubbles up. */
  handleQuestLogDialogKeyDown(event: KeyboardEvent): void;
  handleBackdropClick(event: MouseEvent): void;
  resumeGame(): void;
  endDialogue(): void;
  saveGame(): Promise<void>;
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  dismissOnboardingHint(): void;
  /** Skips the entire onboarding arc (C-422 AC-3). */
  skipOnboardingHint(): void;
};
