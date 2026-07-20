import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types';
import type { RouteName } from '$router';

export type {
  AgentConfig,
  AgentHudState,
  AgentPhase,
  AgentPipelineContext,
  AgentRunResult,
  ThoughtBubble,
} from './agent_types.ts';
export type { CompactedCampaignSummary } from './compacted_campaign_summary.ts';
export type { DevAction, DevToggle } from './dev_action.ts';
export type {
  ActiveContextEntry,
  GameStateEvent,
  GameStateListener,
  GameStateOptions,
} from './game.ts';
export type {
  GameBootInput,
  GameBootProgress,
  GameBootResult,
  GameBootStage,
} from './game_boot.ts';
export type { ImpersonationConfig } from './impersonation.ts';
export type {
  KeywordMatch,
  Lorebook,
  LorebookEntriesArray,
  LorebookEntry,
  LorebookEntryInput,
} from './lorebook';
export type { PlayerJournalEntry } from './player_journal_entry.ts';
export type {
  ChatInputDraft,
  EnhancedChatMessage,
  EnhancedMessage,
  MessageAction,
  MessageAlternatives,
  StreamingTtsConfig,
} from './rich_chat.ts';
export type { SessionCheckpoint } from './session_checkpoint.ts';

export type ClientHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoute?: RouteName;
  logLevel?: LogLevel;
  sessionId?: string;
};
