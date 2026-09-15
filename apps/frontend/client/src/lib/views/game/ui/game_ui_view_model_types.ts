// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_types.ts
//
// Capability contracts for the game UI overlay-router ViewModel. Kept in a
// separate module so the ViewModel stays within its grandfathered size budget.

import type { HudViewport } from '$lib/utils/hud/hud_layout_policy.ts';
import type {
  ChatServiceInterface,
  CombatServiceInterface,
  ConfigServiceInterface,
  GameOverlayServiceInterface,
  HudPreferenceServiceInterface,
  InputActionServiceInterface,
  MotionPreferenceServiceInterface,
  OnboardingHintServiceInterface,
  PlayerStateServiceInterface,
  QuestOverlayServiceInterface,
  RuntimeConfigServiceInterface,
  SessionServiceInterface,
  TimeServiceInterface,
} from '$services';

export type GameUIChatCapabilities = Pick<ChatServiceInterface, 'messages'>;

export type GameUICombatStateCapabilities = Pick<
  CombatServiceInterface,
  'enemyName' | 'enemyNpcId' | 'enemyHp' | 'enemyMaxHp' | 'participantIds' | 'firstTurnEntityId'
>;

export type GameUIConfigCapabilities = Pick<ConfigServiceInterface, 'getActiveTextProvider'>;

export type GameUIRuntimeConfigCapabilities = Pick<RuntimeConfigServiceInterface, 'getTextUrl'>;

export type GameUIOverlayCapabilities = Pick<
  GameOverlayServiceInterface,
  | 'activeOverlay'
  | 'overlayStack'
  | 'isTransitioning'
  | 'autoSaveStatus'
  | 'vendorSessionOptions'
  | 'talkToPartyOptions'
  | '_cameraZoomNpcScreenX'
  | '_cameraZoomNpcScreenY'
  | 'interactionPromptLabel'
  | 'interactionPromptVisible'
  | 'setEngineService'
  | 'initialize'
  | 'handleKeyDown'
  | 'endDialogue'
  | 'resumeGame'
  | 'saveGame'
  | 'respawnPlayer'
  | 'loadLastSave'
  | 'startCombat'
  | 'closeCombat'
  | 'closeQuestLog'
  | 'closeCharacterDashboard'
  | 'closeInventory'
  | 'closePartyRoster'
  | 'closeReputation'
  | 'openInventory'
  | 'openQuestLog'
  | 'openJournal'
  | 'closeJournal'
  | 'openCharacterDashboard'
  | 'openPartyRoster'
  | 'openReputation'
  | 'openWorld'
  | 'closeWorld'
  | 'replaceOverlay'
>;

export type GameUIInputActionCapabilities = Pick<InputActionServiceInterface, 'actionDisplayLabel'>;

export type GameUIOnboardingCapabilities = Pick<
  OnboardingHintServiceInterface,
  | 'currentHint'
  | 'hintVisible'
  | 'stepIndex'
  | 'totalSteps'
  | 'dismissCurrentHint'
  | 'skipOnboarding'
>;

export type GameUIPlayerStateCapabilities = Pick<
  PlayerStateServiceInterface,
  'playerHp' | 'playerMaxHp'
>;

export type GameUIQuestOverlayCapabilities = Pick<QuestOverlayServiceInterface, 'visible'>;

/**
 * C-527 AC-1 / Directive 7 — the persisted clock/weather HUD visibility
 * preference. Off for a new player; an explicit choice is preserved.
 */
export type GameUIClockCapabilities = {
  readonly visible: boolean;
};

export type GameUISessionCapabilities = Pick<
  SessionServiceInterface,
  'chatLocked' | 'checkAutoSummaryThreshold'
>;

export type GameUITimeCapabilities = Pick<
  TimeServiceInterface,
  'gameHour' | 'gameMinute' | 'windVelocity' | 'rainIntensity'
>;

/**
 * C-527 AC-6 — the player's persisted motion selection, shared with
 * Settings > Gameplay so the game HUD and the settings control can never
 * disagree about what the player chose.
 */
export type GameUIMotionCapabilities = Pick<
  MotionPreferenceServiceInterface,
  'preference' | 'setPreference'
>;

/**
 * C-528 — the HUD preference authority the game HUD renders from.
 *
 * The game layer reads the committed snapshot and the temporary Hide HUD flag;
 * it never writes them. Editing goes through the editor/settings surfaces, so
 * there is exactly one store authority (Directive 11).
 */
export type GameUIHudCapabilities = Pick<
  HudPreferenceServiceInterface,
  'preferences' | 'isHudTemporarilyHidden' | 'isEditorEnabled' | 'toggleHudTemporarilyHidden'
>;

/** C-528 — the measured viewport and text scale the HUD reflows against. */
export type GameUIHudViewCapabilities = {
  readonly viewport: HudViewport;
  readonly textScale: number;
};
