import { isDevelopmentModePublic } from '@aikami/frontend/configs';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { DeviceData, DeviceType, LogLevel } from '@aikami/types';

import { isMobileDevice } from '@aikami/utils';
import { logger } from '$logger';

export type AppServiceOptions = BaseFrontendClassOptions;

export type AppServiceInterface = BaseFrontendClassInterface & {
  /**
   * The type of the current device (e.g., 'desktop', 'tablet', 'mobile').
   */
  readonly deviceType: DeviceType;

  /**
   * Indicates if the current device is a mobile or tablet.
   */
  readonly isMobileOrTablet: boolean;

  /**
   * Controls the visibility of the navigation drawer button.
   */
  readonly showNavigationDrawer: boolean;

  /**
   * Current session ID for this page visit.
   */
  sessionId: string | null;

  readonly initialized: boolean;
  readonly isDevelopment: boolean;
  readonly showNotificationDrawer: boolean;

  /**
   * Sets the current device data.
   * @param device The device data to set.
   */
  setCurrentDevice(device: DeviceData): void;

  /**
   * Toggles the visibility of the drawer button.
   * If a value is provided, it will be set directly.
   * If no value is provided, the current visibility will be inverted.
   * @param value The optional boolean value to set.
   */
  toggleNavigationDrawer(value?: boolean): void;

  toggleNotificationDrawer(value?: boolean): void;

  setLogLevel(logLevel: LogLevel): void;

  /**
   * Whether external log flushing to /api/internal_logging is enabled.
   * Mirrors {@link logger.externalLoggingEnabled}.
   */
  readonly externalLoggingEnabled: boolean;

  /**
   * Toggles external logging (HTTP flush to /api/internal_logging).
   * If a value is provided, it is set directly; if no value is provided,
   * the current state is inverted.
   * @param enabled The optional boolean value to set.
   */
  setExternalLogging(enabled?: boolean): void;
};

export class AppService
  extends BaseFrontendClass<AppServiceOptions>
  implements AppServiceInterface
{
  deviceType = $state<DeviceType>('desktop');
  _currentDevice = $state<DeviceData | undefined>();
  showNavigationDrawer = $state(false);
  showNotificationDrawer = $state(false);

  /** Current session ID for this page visit. */
  sessionId = $state<string | null>(null);

  isMobileOrTablet = $derived(isMobileDevice(this._currentDevice));

  isDevelopment = $state(isDevelopmentModePublic());
  initialized = $state(false);

  /** Whether external log flushing to /api/internal_logging is enabled. */
  externalLoggingEnabled = $state(logger.externalLoggingEnabled);

  setCurrentDevice(device: DeviceData): void {
    this._currentDevice = device;
  }

  toggleNavigationDrawer(value?: boolean) {
    this.showNavigationDrawer = value ?? !this.showNavigationDrawer;
  }

  setLogLevel(logLevel: LogLevel) {
    logger.logLevel = logLevel;
  }

  setExternalLogging(enabled?: boolean) {
    const next = enabled ?? !this.externalLoggingEnabled;
    logger.setExternalLogging(next);
    this.externalLoggingEnabled = next;
  }

  toggleNotificationDrawer(value?: boolean) {
    this.showNotificationDrawer = value ?? !this.showNotificationDrawer;
  }
}

export const appService: AppServiceInterface = AppService.create({
  className: 'AppService',
});
