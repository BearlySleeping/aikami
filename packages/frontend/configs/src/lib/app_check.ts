// packages/frontend/configs/src/lib/app_check.ts
import {
  type AppCheck,
  getToken,
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'firebase/app-check';
import { logger } from '$logger';
import app from './app.ts';
import { getPublicMode, isAppCheckEnabled, publicEnv } from './environment';

const initializeAppCheckInstance = (): AppCheck | undefined => {
  try {
    const {
      PUBLIC_DISABLE_APP_CHECK: disableAppCheck,
      PUBLIC_RECAPTCHA_SITE_KEY: recaptchaSiteKey,
    } = publicEnv;
    const isDisabled = disableAppCheck === '1' || disableAppCheck === 'true';
    const mode = getPublicMode();
    const isNonProductionMode = mode && mode !== 'production';

    // Shared predicate (also used by the Hub SSR hooks.server.ts) so the
    // client and server always agree on whether App Check is active.
    if (isAppCheckEnabled()) {
      return initializeAppCheck(app, {
        isTokenAutoRefreshEnabled: true,
        provider: new ReCaptchaV3Provider(recaptchaSiteKey as string),
      });
    }

    // Disable App Check for non-production modes when the debug token
    // isn't registered in the Firebase Console (otherwise exchangeDebugToken
    // returns 403 and cascades to break Firebase Auth entirely).
    //
    // Also skip when no reCAPTCHA site key is configured: the Google test
    // key always returns 403 against real projects and throttles App Check
    // for 24h (appCheck/initial-throttle), breaking Firebase Auth.
    if (isNonProductionMode && !isDisabled) {
      logger.info(
        `App Check disabled for mode "${mode}". ` +
          'Set PUBLIC_DISABLE_APP_CHECK=0 and register the debug token in Firebase Console to enable it.',
      );
    }
    if (!recaptchaSiteKey && !isDisabled) {
      logger.warn(
        'No PUBLIC_RECAPTCHA_SITE_KEY set. App Check disabled — ' +
          'set a real reCAPTCHA site key for production deployments.',
      );
    }
    return;
  } catch (error) {
    logger.warn('Failed to initialize app check', error);
    return;
  }
};

export const appCheck = initializeAppCheckInstance();

/**
 * Retrieves the current App Check token.
 * Useful for including in manual fetch requests to protected backends.
 */
export const getAppCheckToken = async () => {
  if (!appCheck) {
    return;
  }

  const token = await getToken(appCheck);
  return token;
};
