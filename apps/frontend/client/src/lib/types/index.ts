import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types';
import type { RouteName } from '$router';

export type { DevAction, DevToggle } from './dev_action.ts';
export type {
  ActiveContextEntry,
  GameStateEvent,
  GameStateListener,
  GameStateOptions,
} from './game.ts';

export type ClientHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoute?: RouteName;
  logLevel?: LogLevel;
  sessionId?: string;
};
