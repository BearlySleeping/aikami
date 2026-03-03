import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types/index.ts';
import type { RouteName } from '$router.ts';

export type { Character, CharacterCardV1, CharacterCardV2 } from './character.ts';

export type PWAHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoutePath?: RouteName;
  logLevel?: LogLevel;
};
