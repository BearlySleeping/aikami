import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types';
import type { RouteName } from '$router';

export type { Character, CharacterCardV1, CharacterCardV2 } from './character.ts';
export type {
  ActiveContextEntry,
  GameStateEvent,
  GameStateListener,
  GameStateOptions,
} from './game.ts';

export type PWAHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoute?: RouteName;
  logLevel?: LogLevel;
  sessionId?: string;
};
