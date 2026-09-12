// apps/frontend/client/src/lib/views/game/ui/game_ui_view_model_types.ts
//
// Capability contracts for the game UI overlay-router ViewModel. Kept in a
// separate module so the ViewModel stays within its grandfathered size budget.

import type {
  ChatServiceInterface,
  CombatServiceInterface,
  ConfigServiceInterface,
  GameOverlayServiceInterface,
  InputActionServiceInterface,
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
  | 'openInventory'
  | 'openQuestLog'
  | 'openJournal'
  | 'closeJournal'
  | 'openCharacterDashboard'
  | 'openPartyRoster'
  | 'openReputation'
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

export type GameUISessionCapabilities = Pick<
  SessionServiceInterface,
  'chatLocked' | 'checkAutoSummaryThreshold'
>;

export type GameUITimeCapabilities = Pick<
  TimeServiceInterface,
  'gameHour' | 'gameMinute' | 'windVelocity' | 'rainIntensity'
>;
