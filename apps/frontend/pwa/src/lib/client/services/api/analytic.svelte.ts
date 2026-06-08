import {
  type AnalyticsEventName,
  type AnalyticsEventParameters,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  type FirebaseAnalyticServiceInterface,
  firebaseAnalyticService,
  type LogAction,
} from '@aikami/frontend/services';
import type { SignInProvider, UserData, UserLiteData, UserRole, UserStatus } from '@aikami/types';
import { BaseClass } from '@aikami/utils';

export type AnalyticsAuthData = {
  currentSignInProvider: SignInProvider;
  isBetaTester?: boolean;
  status?: UserStatus;
  userRole?: UserRole;
};

export const toAnalyticsAuthData = (user: UserData | UserLiteData): AnalyticsAuthData => {
  const analyticsAuthData: AnalyticsAuthData = {
    currentSignInProvider: user.signInProviders?.[0] ?? 'email',
  };

  if (user.userRole) {
    analyticsAuthData.userRole = user.userRole;
  }

  if (user.status) {
    analyticsAuthData.status = user.status;
  }

  return analyticsAuthData;
};

export type AnalyticServiceOptions = BaseFrontendClassOptions & {
  analytics: FirebaseAnalyticServiceInterface;
};

export type AnalyticServiceInterface = BaseFrontendClassInterface & {
  /**
   * @param eventName The functions.httpsCallable function from the firebase
   *   api
   * @param eventParameters The request data to send to the cloud function
   */
  logEvent<T extends AnalyticsEventName>(
    eventName: T,
    eventParameters: AnalyticsEventParameters<T>,
  ): Promise<void>;

  logAction(action: LogAction): Promise<void>;

  /**
   * Sets the analytics user.
   * @param user The user to set.
   */
  setAnalyticUser(user: UserData | UserLiteData): Promise<void>;
};

export class AnalyticService
  extends BaseClass<AnalyticServiceOptions>
  implements AnalyticServiceInterface
{
  private get _analytic(): FirebaseAnalyticServiceInterface {
    return this._options.analytics;
  }

  async logAction(action: LogAction): Promise<void> {
    try {
      await this.logEvent('pwaAction', {
        action,
      });
    } catch (error) {
      this.error('logAction', error);
    }
  }

  async logEvent<T extends AnalyticsEventName>(
    eventName: T,
    eventParameters: AnalyticsEventParameters<T>,
  ): Promise<void> {
    try {
      await this._analytic.logEvent(eventName, eventParameters);
    } catch (error) {
      this.error('logEvent', error);
    }
  }

  async setAnalyticUser(user: UserData | UserLiteData): Promise<void> {
    try {
      await Promise.all([
        this._analytic.setUserId(user.id),
        this._analytic.setUserProperties(toAnalyticsAuthData(user)),
      ]);
    } catch (error) {
      this.error('setAnalyticUser', error);
    }
  }
}

export const analyticService: AnalyticServiceInterface = AnalyticService.create({
  analytics: firebaseAnalyticService,
  className: 'AnalyticService',
});
