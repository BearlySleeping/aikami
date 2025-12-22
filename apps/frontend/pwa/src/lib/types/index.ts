import type { DeviceData, LogLevel, UserSessionData } from '@aikami/types'
import type { RouteName } from '$router'

export type PWAHookData = {
  device?: DeviceData
  userSession?: UserSessionData
  currentRoutePath?: RouteName
  logLevel?: LogLevel
}
