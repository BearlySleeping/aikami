import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types';
import type { RouteName } from '$router';

export type AdminHookData = {
  device?: DeviceData;
  userSession?: UserSessionData;
  currentRoute?: RouteName;
  logLevel?: LogLevel;
  sessionId?: string;
};
