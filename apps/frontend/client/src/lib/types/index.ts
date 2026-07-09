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
export type { DevAction, DevToggle } from './dev_action.ts';
export type {
  ActiveContextEntry,
  GameStateEvent,
  GameStateListener,
  GameStateOptions,
} from './game.ts';
export type {
  KeywordMatch,
  Lorebook,
  LorebookEntriesArray,
  LorebookEntry,
  LorebookEntryInput,
} from './lorebook';
export type {
  ChatInputDraft,
  EnhancedChatMessage,
  EnhancedMessage,
  MessageAction,
  MessageAlternatives,
  StreamingTtsConfig,
} from './rich_chat.ts';

export type ClientHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoute?: RouteName;
  logLevel?: LogLevel;
  sessionId?: string;
};
