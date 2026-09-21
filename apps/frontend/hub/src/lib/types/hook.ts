import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types';
import type { RouteName } from '$router';

export type HubHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoute?: RouteName;
  logLevel?: LogLevel;
  sessionId?: string;
};
